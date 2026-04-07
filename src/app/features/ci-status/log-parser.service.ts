import { Injectable, inject } from '@angular/core';
import { GitHubApiService } from '../../core';
import { ParsedTestFailure } from '../../models';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LogParserService {
  private readonly api = inject(GitHubApiService);

  /**
   * Download and parse logs for a specific job.
   */
  async parseJobLogs(
    owner: string,
    repo: string,
    jobId: number,
  ): Promise<{ failures: ParsedTestFailure[]; logAccessible: boolean; nxCloudUrl?: string }> {
    try {
      const rawLog = await firstValueFrom(this.api.getJobLogs(owner, repo, jobId));
      const failures = this.parseTestFailuresFromLog(rawLog);

      // Extract Nx Cloud URL
      const nxMatch = rawLog.match(/https?:\/\/cloud\.nx\.app\/cipes\/[a-f0-9]+/i);
      const nxCloudUrl = nxMatch ? nxMatch[0] : undefined;

      return { failures, logAccessible: true, nxCloudUrl };
    } catch {
      return { failures: [], logAccessible: false };
    }
  }

  /**
   * Parse raw GitHub Actions log text. Handles:
   *   - Mocha-style output (numbered failures)
   *   - Jest/Vitest FAIL blocks
   *   - Nx prefixed log lines (e.g. "project-name: 1 failing")
   */
  parseTestFailuresFromLog(rawLog: string): ParsedTestFailure[] {
    // Strip ANSI codes + GitHub Actions timestamps
    const clean = rawLog
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/gm, '');

    const failures: ParsedTestFailure[] = [];

    // Strategy: detect Nx-prefixed lines like "project-name:  1 failing"
    // Then capture subsequent numbered test failures
    this.parseMochaFailures(clean, failures);
    this.parseJestVitest(clean, failures);

    return this.deduplicate(failures);
  }

  /**
   * Parse Mocha-style numbered failures (used by component-test, Cypress CT).
   *
   * Pattern in logs:
   *   hp-calendar-feat-settings-account:   1 failing
   *   hp-calendar-feat-settings-account:
   *   hp-calendar-feat-settings-account:   1) AccountShell
   *   hp-calendar-feat-settings-account:        Contact section
   *   hp-calendar-feat-settings-account:          should validate the form:
   *   hp-calendar-feat-settings-account:     AssertionError: expected 'subject' to have text ...
   *   hp-calendar-feat-settings-account:       + expected - actual
   *   hp-calendar-feat-settings-account:       +'Field is required'
   */
  private parseMochaFailures(log: string, failures: ParsedTestFailure[]): void {
    const lines = log.split('\n');

    // Find lines that match "project: N failing"
    const failingLineRegex = /^(\S+?):\s+(\d+)\s+failing\s*$/;
    // Find numbered test entries like "project:   1) SuiteName"
    const numberedTestRegex = /^(\S+?):\s+(\d+)\)\s+(.+)$/;

    let i = 0;
    while (i < lines.length) {
      const failingMatch = failingLineRegex.exec(lines[i]);
      if (!failingMatch) {
        i++;
        continue;
      }

      const projectPrefix = failingMatch[1];
      const failCount = parseInt(failingMatch[2], 10);

      // Now scan forward for numbered tests under this project
      i++;
      let foundTests = 0;

      while (i < lines.length && foundTests < failCount) {
        const testMatch = numberedTestRegex.exec(lines[i]);
        if (testMatch && testMatch[1] === projectPrefix) {
          // Found a numbered test failure
          const testPathParts: string[] = [testMatch[3].trim()];
          i++;

          // Collect indented continuation lines (describe nesting + test name)
          const prefixPattern = projectPrefix + ':';
          while (i < lines.length && lines[i].startsWith(prefixPattern)) {
            const afterPrefix = lines[i].substring(prefixPattern.length);

            // Stop if we hit the next numbered test
            if (numberedTestRegex.test(lines[i])) break;

            // Stop if we hit the error message
            const trimmed = afterPrefix.trim();
            if (!trimmed) {
              i++;
              continue;
            }

            // If starts with assertion/error keywords, it's error context
            if (this.isErrorLine(trimmed)) {
              break;
            }

            // Otherwise it's a test path component
            // Remove trailing colon (last part before the error)
            const pathPart = trimmed.replace(/:$/, '');
            if (pathPart) {
              testPathParts.push(pathPart);
            }
            i++;
          }

          // Now collect error message lines
          let errorMessage = '';
          let diff: string | null = null;
          const diffLines: string[] = [];
          let inDiff = false;

          while (i < lines.length && lines[i].startsWith(prefixPattern)) {
            const afterPrefix = lines[i].substring(prefixPattern.length);
            const trimmed = afterPrefix.trim();

            // Stop at next numbered test or next "N failing" line
            if (numberedTestRegex.test(lines[i])) break;
            if (failingLineRegex.test(lines[i])) break;

            if (!trimmed) {
              // Blank line within errors — might end the block
              if (errorMessage) {
                i++;
                // Check if next lines are still part of this failure
                if (i < lines.length && lines[i].startsWith(prefixPattern)) {
                  const nextTrimmed = lines[i].substring(prefixPattern.length).trim();
                  if (nextTrimmed && !numberedTestRegex.test(lines[i]) && !failingLineRegex.test(lines[i])) {
                    continue;
                  }
                }
                break;
              }
              i++;
              continue;
            }

            // Detect diff section
            if (trimmed.startsWith('+ expected') || trimmed.startsWith('- actual') || trimmed === '+ expected - actual') {
              inDiff = true;
              diffLines.push(trimmed);
              i++;
              continue;
            }

            if (inDiff) {
              // Diff lines start with +/- and some content
              if (trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('\'') || trimmed.startsWith('"')) {
                diffLines.push(trimmed);
              } else {
                inDiff = false;
              }
            }

            if (!inDiff) {
              if (errorMessage) errorMessage += '\n';
              errorMessage += trimmed;
            }

            i++;
          }

          if (diffLines.length > 0) {
            diff = diffLines.join('\n');
          }

          // Determine the target from the job/project context
          const target = this.guessTarget(projectPrefix, log);

          failures.push({
            suite: projectPrefix,
            target,
            testPath: testPathParts,
            errorMessage: errorMessage.trim(),
            diff,
          });

          foundTests++;
        } else {
          i++;
        }
      }
    }
  }

  /**
   * Parse Jest/Vitest-style failures.
   *
   * Pattern:
   *   FAIL libs/my-lib/src/foo.spec.ts
   *     ● Suite Name › test name
   *       Error: expected ...
   */
  private parseJestVitest(log: string, failures: ParsedTestFailure[]): void {
    const lines = log.split('\n');

    // Look for "FAIL path/to/file.spec.ts"
    const failFileRegex = /FAIL\s+(.+\.(?:spec|test)\.[tj]sx?)/;
    // Look for "● Suite › test"
    const jestTestRegex = /^\s*●\s+(.+\s+›\s+.+)$/;

    let currentFile: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const fileMatch = failFileRegex.exec(lines[i]);
      if (fileMatch) {
        currentFile = fileMatch[1].trim();
        continue;
      }

      const testMatch = jestTestRegex.exec(lines[i]);
      if (testMatch && currentFile) {
        const fullPath = testMatch[1].trim();
        const parts = fullPath.split(/\s+›\s+/);

        // Collect error lines after the test name
        let errorMessage = '';
        let diff: string | null = null;
        const diffLines: string[] = [];
        let j = i + 1;

        while (j < lines.length) {
          const line = lines[j].trim();
          if (!line || jestTestRegex.test(lines[j]) || failFileRegex.test(lines[j])) break;

          // Detect diff
          if (line.startsWith('- Expected') || line.startsWith('+ Received') || line.startsWith('Expected:') || line.startsWith('Received:')) {
            diffLines.push(line);
          } else if (diffLines.length > 0 && (line.startsWith('-') || line.startsWith('+'))) {
            diffLines.push(line);
          } else {
            if (errorMessage) errorMessage += '\n';
            errorMessage += line;
          }
          j++;
        }

        if (diffLines.length > 0) diff = diffLines.join('\n');

        // Extract project from file path
        const suite = this.extractProjectFromPath(currentFile);

        failures.push({
          suite,
          target: 'test',
          testPath: parts,
          errorMessage,
          diff,
        });
      }
    }
  }

  private isErrorLine(line: string): boolean {
    return /^(AssertionError|AssertError|Error|TypeError|ReferenceError|expect|assert|Assertion)/i.test(line)
      || line.startsWith('at ')
      || /^(CypressError|TimeoutError)/.test(line);
  }

  private guessTarget(projectPrefix: string, log: string): string {
    // Look for "nx run project:target" near this project
    const targetMatch = log.match(new RegExp(`nx run ${projectPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\S+)`));
    if (targetMatch) return targetMatch[1];
    return 'component-test';
  }

  private extractProjectFromPath(filePath: string): string {
    // libs/my-project/src/... → my-project
    const match = filePath.match(/(?:libs|packages|apps)\/([^/]+)/);
    if (match) return match[1];
    return filePath.split('/')[0] || 'unknown';
  }

  private deduplicate(failures: ParsedTestFailure[]): ParsedTestFailure[] {
    const seen = new Set<string>();
    return failures.filter(f => {
      const key = `${f.suite}::${f.testPath.join(' > ')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
