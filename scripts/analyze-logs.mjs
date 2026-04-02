#!/usr/bin/env node

/**
 * analyze-logs.mjs
 *
 * Downloads GitHub Actions logs for failed jobs in a PR, parses them
 * to find test failures, and outputs a report with nx rerun commands.
 *
 * Usage:
 *   node scripts/analyze-logs.mjs <PR_URL> [--token <PAT>]
 *
 * Examples:
 *   node scripts/analyze-logs.mjs https://github.com/rosahealth/rosa/pull/19182
 *   node scripts/analyze-logs.mjs https://github.com/rosahealth/rosa/pull/19182 --token ghp_xxx
 *
 * Environment variables:
 *   GITHUB_TOKEN — Personal Access Token (fallback if --token not provided)
 */

const GITHUB_API = 'https://api.github.com';

// ─── CLI Arguments ────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log(`
  Usage: node scripts/analyze-logs.mjs <PR_URL> [--token <PAT>]

  <PR_URL>       Full GitHub PR URL (e.g. https://github.com/owner/repo/pull/123)
  --token <PAT>  GitHub Personal Access Token (or set GITHUB_TOKEN env var)
  `);
  process.exit(0);
}

const prUrl = args[0];
const tokenIdx = args.indexOf('--token');
const token = tokenIdx !== -1 ? args[tokenIdx + 1] : process.env.GITHUB_TOKEN;

if (!token) {
  console.error('❌ No token provided. Use --token <PAT> or set GITHUB_TOKEN env var.');
  process.exit(1);
}

// Parse PR URL
const prMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
if (!prMatch) {
  console.error('❌ Invalid PR URL. Expected: https://github.com/owner/repo/pull/123');
  process.exit(1);
}

const [, owner, repo, prNumber] = prMatch;

// ─── API Helpers ──────────────────────────────────────────────────────

async function ghFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${res.statusText} — ${url}`);
  }
  return res;
}

async function ghJson(url) {
  const res = await ghFetch(url);
  return res.json();
}

// ─── Fetch PR + Failed Runs ──────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Analyzing PR: ${owner}/${repo}#${prNumber}\n`);

  // 1. Get PR head SHA
  const pr = await ghJson(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`);
  const headSha = pr.head.sha;
  console.log(`  HEAD SHA: ${headSha.substring(0, 8)}`);
  console.log(`  Branch:   ${pr.head.ref} → ${pr.base.ref}`);
  console.log(`  Title:    ${pr.title}\n`);

  // 2. Get workflow runs for this SHA
  const runsResult = await ghJson(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=100`
  );
  const failedRuns = runsResult.workflow_runs.filter(r => r.conclusion === 'failure');

  if (failedRuns.length === 0) {
    console.log('✅ No failed workflow runs found. All green!');
    process.exit(0);
  }

  console.log(`⚠️  Found ${failedRuns.length} failed workflow run(s)\n`);

  // 3. For each failed run, get failed jobs and download logs
  const allFailures = [];

  for (const run of failedRuns) {
    console.log(`─── Workflow: ${run.name} (Run #${run.run_number}) ───`);

    const jobsResult = await ghJson(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`
    );
    const failedJobs = jobsResult.jobs.filter(j => j.conclusion === 'failure');

    for (const job of failedJobs) {
      console.log(`  📋 Job: ${job.name}`);

      // Show failed steps
      const failedSteps = (job.steps || []).filter(s => s.conclusion === 'failure');
      for (const step of failedSteps) {
        console.log(`     ✕ Step ${step.number}: ${step.name}`);
      }

      // Download job log
      let logText = '';
      try {
        const logRes = await ghFetch(
          `${GITHUB_API}/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
          { redirect: 'follow' }
        );
        logText = await logRes.text();
      } catch (err) {
        console.log(`     ⚠ Could not download log: ${err.message}`);
        continue;
      }

      // Parse failures from log
      const parsed = parseTestFailures(logText, job.name);
      if (parsed.length > 0) {
        allFailures.push(...parsed);
        for (const f of parsed) {
          console.log(`     🔴 ${f.testName}`);
          if (f.file) console.log(`        File: ${f.file}`);
          if (f.errorMessage) console.log(`        Error: ${f.errorMessage.substring(0, 120)}`);
        }
      } else {
        console.log('     ℹ No specific test failures detected in logs.');
      }
      console.log();
    }
  }

  // ─── Summary Report ────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(72));
  console.log('  TEST FAILURE REPORT');
  console.log('═'.repeat(72) + '\n');

  if (allFailures.length === 0) {
    console.log('  No specific test failures could be extracted from the logs.');
    console.log('  The job(s) may have failed during setup, build, or lint steps.\n');
    console.log('  Rerun all failed runs:');
    for (const run of failedRuns) {
      console.log(`    gh run rerun ${run.id} --failed`);
    }
    process.exit(0);
  }

  console.log(`  ${allFailures.length} failing test(s) found:\n`);

  // Group by project
  const byProject = new Map();
  for (const f of allFailures) {
    const project = f.nxProject || f.jobName || 'unknown';
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(f);
  }

  for (const [project, failures] of byProject) {
    console.log(`  ┌─ Project: ${project}`);
    for (const f of failures) {
      console.log(`  │  ✕ ${f.testName}`);
      if (f.file) console.log(`  │    📁 ${f.file}`);
      if (f.errorMessage) {
        const lines = f.errorMessage.split('\n').slice(0, 3);
        for (const line of lines) {
          console.log(`  │    ${line.trim()}`);
        }
      }
    }
    console.log('  └─');
    console.log();
  }

  // ─── NX Rerun Commands ─────────────────────────────────────────────

  console.log('─'.repeat(72));
  console.log('  NX RERUN COMMANDS');
  console.log('─'.repeat(72) + '\n');

  const nxProjects = [...new Set(allFailures.filter(f => f.nxProject).map(f => f.nxProject))];
  const specFiles = [...new Set(allFailures.filter(f => f.file).map(f => f.file))];

  if (nxProjects.length > 0) {
    // Per-project test commands
    for (const proj of nxProjects) {
      const projectSpecs = allFailures
        .filter(f => f.nxProject === proj && f.file)
        .map(f => f.file);

      if (projectSpecs.length > 0) {
        console.log(`  # Test specific files in ${proj}:`);
        console.log(`  npx nx test ${proj} -- --testPathPattern="${projectSpecs.join('|')}"\n`);
      } else {
        console.log(`  # Run all tests for ${proj}:`);
        console.log(`  npx nx test ${proj}\n`);
      }
    }

    // Run all affected
    console.log('  # Or run all failing projects at once:');
    console.log(`  npx nx run-many -t test -p ${nxProjects.join(',')}\n`);
  } else if (specFiles.length > 0) {
    // If we found spec files but not project names
    console.log('  # Run specific failing test files:');
    for (const spec of specFiles) {
      console.log(`  npx nx test --testPathPattern="${spec}"`);
    }
    console.log();
  }

  // GitHub CLI reruns
  console.log('  # GitHub Actions rerun commands:');
  for (const run of failedRuns) {
    console.log(`  gh run rerun ${run.id} --failed`);
  }
  console.log();
}

// ─── Log Parsing ─────────────────────────────────────────────────────

function parseTestFailures(logText, jobName) {
  const failures = [];

  // Strip ANSI escape codes and GitHub Actions timestamp prefixes
  const clean = logText
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/gm, '');

  // ─── 1. Jest / Vitest FAIL pattern ────────────────────────────────
  // Matches: FAIL libs/my-lib/src/foo.spec.ts
  //          FAIL src/app/bar.spec.ts
  const failFileRegex = /^.*FAIL\s+(.+\.(?:spec|test)\.[tj]sx?)$/gm;
  let match;
  while ((match = failFileRegex.exec(clean)) !== null) {
    const file = match[1].trim();
    failures.push({
      testName: `FAIL ${file}`,
      file,
      jobName,
      nxProject: extractNxProject(file, clean),
      errorMessage: extractErrorContext(clean, match.index),
    });
  }

  // ─── 2. Jest individual test failure ──────────────────────────────
  // Matches: ● Suite Name › test name
  //          × Suite Name › test name
  // Only match lines with ' › ' separator (Jest test output format)
  const testNameRegex = /^\s*[●×]\s+(.+ › .+)$/gm;
  while ((match = testNameRegex.exec(clean)) !== null) {
    const testName = match[1].trim();
    // Skip "Test suite failed to run" — already caught as FAIL
    if (testName.startsWith('Test suite failed')) continue;
    if (failures.some(f => f.testName === testName)) continue;

    failures.push({
      testName,
      file: extractTestFile(clean, match.index),
      jobName,
      nxProject: extractNxProjectFromContext(clean, match.index),
      errorMessage: extractErrorContext(clean, match.index),
    });
  }

  // ─── 3. Nx "Failed tasks" summary ─────────────────────────────────
  // Matches: - nx run project-name:test
  //          NX   Running target test for project project-name failed
  const nxTestFailRegex = /nx run ([^:\s]+):test/g;
  while ((match = nxTestFailRegex.exec(clean)) !== null) {
    const proj = match[1];
    if (!failures.some(f => f.nxProject === proj)) {
      failures.push({
        testName: `nx run ${proj}:test`,
        file: null,
        jobName,
        nxProject: proj,
        errorMessage: extractErrorContext(clean, match.index),
      });
    }
  }

  // ─── 3b. Nx failed targets (build, lint, e2e, etc.) ───────────────
  const nxOtherFailRegex = /nx run ([^:\s]+):(build|lint|e2e|serve|storybook)/g;
  while ((match = nxOtherFailRegex.exec(clean)) !== null) {
    const proj = match[1];
    const target = match[2];
    const key = `${proj}:${target}`;
    if (!failures.some(f => f.testName === `nx run ${key}`)) {
      failures.push({
        testName: `nx run ${key}`,
        file: null,
        jobName,
        nxProject: proj,
        errorMessage: extractErrorContext(clean, match.index),
      });
    }
  }

  // ─── 4. Vitest failure banner ─────────────────────────────────────
  // Matches: ❯ src/path/to/file.test.ts (N)
  //          FAIL  src/path/to/file.test.ts
  const vitestFailRegex = /(?:❯|FAIL)\s+(.+\.(?:spec|test)\.[tj]sx?)/gm;
  while ((match = vitestFailRegex.exec(clean)) !== null) {
    const file = match[1].trim();
    if (!failures.some(f => f.file === file)) {
      failures.push({
        testName: `FAIL ${file}`,
        file,
        jobName,
        nxProject: extractNxProject(file, clean),
        errorMessage: extractErrorContext(clean, match.index),
      });
    }
  }

  // ─── 5. Vitest / Jest test assertion failure ──────────────────────
  // Matches: ✕ test description (duration)  — specifically test runner output
  //          AssertionError: expected ... to equal ...
  const vitestTestFailRegex = /^\s*✕\s+(.+?)\s+\d+\s*m?s$/gm;
  while ((match = vitestTestFailRegex.exec(clean)) !== null) {
    const testName = match[1].trim();
    if (!failures.some(f => f.testName === testName)) {
      failures.push({
        testName,
        file: extractTestFile(clean, match.index),
        jobName,
        nxProject: extractNxProjectFromContext(clean, match.index),
        errorMessage: extractErrorContext(clean, match.index),
      });
    }
  }

  // ─── 6. TypeScript / Build errors ─────────────────────────────────
  // Matches: error TS2345: Argument of type ... is not assignable
  //          ERROR in src/app/foo.ts(12,3):
  const tsErrorRegex = /error (TS\d+):\s+(.+)/g;
  while ((match = tsErrorRegex.exec(clean)) !== null) {
    const errorCode = match[1];
    const errorMsg = match[2].trim();
    const key = `${errorCode}: ${errorMsg.substring(0, 80)}`;
    if (!failures.some(f => f.testName === key)) {
      failures.push({
        testName: key,
        file: extractTsErrorFile(clean, match.index),
        jobName,
        nxProject: extractNxProjectFromContext(clean, match.index),
        errorMessage: errorMsg,
      });
    }
  }

  // Deduplicate by file
  const seen = new Set();
  return failures.filter(f => {
    const key = f.file || f.testName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractNxProject(file, fullLog) {
  if (!file) return null;

  // Try to extract from "nx run <project>:test" near this file mention
  // Pattern: libs/<project>/... or apps/<project>/...
  const pathMatch = file.match(/(?:libs|packages|apps)\/([^/]+)/);
  if (pathMatch) return pathMatch[1];

  // Try from full log: "nx run project:test" context
  const nxRunMatch = fullLog.match(/nx run ([^:\s]+):test/);
  if (nxRunMatch) return nxRunMatch[1];

  return null;
}

function extractNxProjectFromContext(log, position) {
  // Look backwards from position for an "nx run <project>:test" line
  const before = log.substring(Math.max(0, position - 5000), position);
  const matches = [...before.matchAll(/nx run ([^:\s]+):test/g)];
  if (matches.length > 0) return matches[matches.length - 1][1];
  return null;
}

function extractTestFile(log, position) {
  // Look backwards for a FAIL filepath or a "at" stack trace path
  const before = log.substring(Math.max(0, position - 2000), position);

  const failMatch = [...before.matchAll(/FAIL\s+(.+\.(?:spec|test)\.[tj]sx?)/g)];
  if (failMatch.length > 0) return failMatch[failMatch.length - 1][1].trim();

  return null;
}

function extractErrorContext(log, position) {
  // Grab up to 500 chars after the match for error context
  const after = log.substring(position, position + 500);
  const lines = after.split('\n').slice(1, 8); // skip the matched line itself

  // Find meaningful error lines (skip empty, timestamps, etc.)
  const errorLines = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('at ') && l.length < 200);

  return errorLines.slice(0, 5).join('\n') || null;
}

function extractTsErrorFile(log, position) {
  // Look backwards for a file path like src/foo.ts(12,3):
  const before = log.substring(Math.max(0, position - 500), position);
  const fileMatch = [...before.matchAll(/([^\s]+\.[tj]sx?)\s*\(\d+,\d+\)/g)];
  if (fileMatch.length > 0) return fileMatch[fileMatch.length - 1][1];

  // Or just a .ts file on the same/previous line
  const tsMatch = [...before.matchAll(/([^\s]+\.[tj]sx?):/g)];
  if (tsMatch.length > 0) return tsMatch[tsMatch.length - 1][1];

  return null;
}

// ─── Run ─────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  process.exit(1);
});
