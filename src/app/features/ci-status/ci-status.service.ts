import { Injectable, inject } from '@angular/core';
import { GitHubApiService } from '../../core';
import {
  CIStatus,
  CheckRun,
  WorkflowRun,
  WorkflowJob,
  WorkflowJobWithErrors,
  CheckAnnotation,
  PullRequest,
} from '../../models';
import { firstValueFrom } from 'rxjs';
import { LogParserService } from './log-parser.service';

@Injectable({ providedIn: 'root' })
export class CiStatusService {
  private readonly api = inject(GitHubApiService);
  private readonly logParser = inject(LogParserService);

  /**
   * Determine the overall CI status from check runs.
   */
  computeCIStatus(checkRuns: CheckRun[]): CIStatus {
    if (checkRuns.length === 0) return 'unknown';

    const hasFailure = checkRuns.some(
      cr => cr.conclusion === 'failure' || cr.conclusion === 'timed_out' || cr.conclusion === 'cancelled',
    );
    const hasPending = checkRuns.some(
      cr => cr.status === 'in_progress' || cr.status === 'queued',
    );

    if (hasFailure) return 'failure';
    if (hasPending) return 'pending';

    const allSuccess = checkRuns.every(
      cr => cr.conclusion === 'success' || cr.conclusion === 'skipped' || cr.conclusion === 'neutral',
    );
    if (allSuccess) return 'success';

    return 'neutral';
  }

  /**
   * Load all check runs for a PR's head SHA.
   */
  async loadCheckRuns(pr: PullRequest): Promise<CheckRun[]> {
    const owner = pr.base.repo.owner.login;
    const repo = pr.base.repo.name;
    const sha = pr.head.sha;

    try {
      const result = (await firstValueFrom(this.api.getCheckRunsForRef(owner, repo, sha))) as { check_runs: CheckRun[] };
      return result.check_runs;
    } catch {
      return [];
    }
  }

  /**
   * Load failed workflow runs for a PR's head SHA.
   */
  async loadFailedWorkflowRuns(pr: PullRequest): Promise<WorkflowRun[]> {
    const owner = pr.base.repo.owner.login;
    const repo = pr.base.repo.name;
    const sha = pr.head.sha;

    try {
      const result = (await firstValueFrom(this.api.getWorkflowRuns(owner, repo, sha))) as { workflow_runs: WorkflowRun[] };
      return result.workflow_runs.filter(run => run.conclusion === 'failure' || run.status === 'in_progress');
    } catch {
      return [];
    }
  }

  /**
   * For a failed workflow run, load the jobs, their annotations, AND parsed log failures.
   */
  async loadFailedJobsWithErrors(
    pr: PullRequest,
    failedRuns: WorkflowRun[],
  ): Promise<WorkflowJobWithErrors[]> {
    const owner = pr.base.repo.owner.login;
    const repo = pr.base.repo.name;
    const results: WorkflowJobWithErrors[] = [];

    for (const run of failedRuns) {
      try {
        const jobsResult = (await firstValueFrom(this.api.getJobsForRun(owner, repo, run.id))) as { jobs: WorkflowJob[] };
        const failedJobs = jobsResult.jobs.filter(j => j.conclusion === 'failure');

        for (const job of failedJobs) {
          // Fetch annotations + logs in parallel
          const [annotations, { failures: testFailures, logAccessible, nxCloudUrl }] = await Promise.all([
            firstValueFrom(this.api.getAnnotations(owner, repo, job.id)).catch(() => [] as CheckAnnotation[]),
            this.logParser.parseJobLogs(owner, repo, job.id),
          ]);

          results.push({
            job,
            annotations,
            testFailures,
            logAccessible,
            runName: run.name,
            runId: run.id,
            repoFullName: `${owner}/${repo}`,
            nxCloudUrl,
          });
        }
      } catch {
        // skip runs we can't access
      }
    }

    return results;
  }

  /**
   * Rerun only the failed jobs of a workflow run.
   */
  async rerunFailedJobs(owner: string, repo: string, runId: number): Promise<boolean> {
    try {
      await firstValueFrom(this.api.rerunFailedJobs(owner, repo, runId)) as any;
      return true;
    } catch {
      return false;
    }
  }
}
