import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  GitHubUser,
  PullRequest,
  CheckRun,
  WorkflowRun,
  WorkflowJob,
  CheckAnnotation,
} from '../models';

const API_BASE = 'https://api.github.com';

@Injectable({ providedIn: 'root' })
export class GitHubApiService {
  private readonly http = inject(HttpClient);

  getAuthenticatedUser(): Observable<GitHubUser> {
    return this.http.get<GitHubUser>(`${API_BASE}/user`);
  }

  /**
   * Search for open PRs authored by the given user.
   */
  searchUserPullRequests(username: string, repo?: string): Observable<{ items: PullRequest[] }> {
    // We cast because the search endpoint returns issue-shaped objects
    // but we enrich them later with full PR data
    let q = `is:pr is:open author:${username}`;
    if (repo) {
      q += ` repo:${repo}`;
    }
    const params = new HttpParams()
      .set('q', q)
      .set('sort', 'updated')
      .set('order', 'desc')
      .set('per_page', '100');
    return this.http.get<{ items: PullRequest[] }>(`${API_BASE}/search/issues`, { params });
  }

  /**
   * Get full PR data (with head SHA, base info, etc.)
   */
  getPullRequest(owner: string, repo: string, prNumber: number): Observable<PullRequest> {
    return this.http.get<PullRequest>(
      `${API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
    );
  }

  /**
   * Get check runs for a specific commit SHA.
   */
  getCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string,
  ): Observable<{ total_count: number; check_runs: CheckRun[] }> {
    const params = new HttpParams().set('per_page', '100');
    return this.http.get<{ total_count: number; check_runs: CheckRun[] }>(
      `${API_BASE}/repos/${owner}/${repo}/commits/${ref}/check-runs`,
      { params },
    );
  }

  /**
   * Get workflow runs for a repo, optionally filtered by head SHA.
   */
  getWorkflowRuns(
    owner: string,
    repo: string,
    headSha: string,
  ): Observable<{ total_count: number; workflow_runs: WorkflowRun[] }> {
    const params = new HttpParams().set('head_sha', headSha).set('per_page', '100');
    return this.http.get<{ total_count: number; workflow_runs: WorkflowRun[] }>(
      `${API_BASE}/repos/${owner}/${repo}/actions/runs`,
      { params },
    );
  }

  /**
   * Get jobs for a specific workflow run.
   */
  getJobsForRun(
    owner: string,
    repo: string,
    runId: number,
  ): Observable<{ total_count: number; jobs: WorkflowJob[] }> {
    const params = new HttpParams().set('per_page', '100').set('filter', 'latest');
    return this.http.get<{ total_count: number; jobs: WorkflowJob[] }>(
      `${API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
      { params },
    );
  }

  /**
   * Get annotations for a check run (error messages).
   */
  getAnnotations(
    owner: string,
    repo: string,
    checkRunId: number,
  ): Observable<CheckAnnotation[]> {
    return this.http.get<CheckAnnotation[]>(
      `${API_BASE}/repos/${owner}/${repo}/check-runs/${checkRunId}/annotations`,
    );
  }

  /**
   * Download raw logs for a specific job (returns plain text).
   */
  getJobLogs(owner: string, repo: string, jobId: number): Observable<string> {
    return this.http.get(
      `${API_BASE}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
      { responseType: 'text' },
    );
  }

  /**
   * Rerun only the failed jobs in a workflow run.
   */
  rerunFailedJobs(owner: string, repo: string, runId: number): Observable<void> {
    return this.http.post<void>(
      `${API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`,
      {},
    );
  }

  /**
   * Rerun entire workflow.
   */
  rerunWorkflow(owner: string, repo: string, runId: number): Observable<void> {
    return this.http.post<void>(
      `${API_BASE}/repos/${owner}/${repo}/actions/runs/${runId}/rerun`,
      {},
    );
  }

  /**
   * Get reviews for a pull request.
   */
  getReviews(owner: string, repo: string, prNumber: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
  }

  /**
   * Merge a pull request.
   */
  mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash',
  ): Observable<any> {
    return this.http.put(`${API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      merge_method: mergeMethod,
    });
  }

  /**
   * Get general comments on a pull request (issue-level comments).
   */
  getPrComments(owner: string, repo: string, prNumber: number): Observable<any[]> {
    const params = new HttpParams().set('per_page', '100');
    return this.http.get<any[]>(
      `${API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      { params },
    );
  }

  /**
   * Get inline code review comments on a pull request.
   */
  getPrReviewComments(owner: string, repo: string, prNumber: number): Observable<any[]> {
    const params = new HttpParams().set('per_page', '100');
    return this.http.get<any[]>(
      `${API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      { params },
    );
  }

  /**
   * Post a general comment on a pull request.
   */
  createPrComment(owner: string, repo: string, prNumber: number, body: string): Observable<any> {
    return this.http.post<any>(
      `${API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      { body },
    );
  }

  /**
   * Reply to an inline review comment.
   */
  replyToReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
  ): Observable<any> {
    return this.http.post<any>(
      `${API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
      { body },
    );
  }

  /**
   * Update a pull request's title and/or body.
   */
  updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    title: string,
    body: string,
  ): Observable<PullRequest> {
    return this.http.patch<PullRequest>(
      `${API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
      { title, body },
    );
  }

  /**
   * Request reviewers for a pull request.
   */
  requestReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[],
  ): Observable<void> {
    return this.http.post<void>(
      `${API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      { reviewers },
    );
  }

  /**
   * Get rate limit status.
   */
  getRateLimit(): Observable<{
    resources: { core: { remaining: number; limit: number; reset: number } };
  }> {
    return this.http.get<{
      resources: { core: { remaining: number; limit: number; reset: number } };
    }>(`${API_BASE}/rate_limit`);
  }

  /**
   * Get PR discussion resolution status via GraphQL.
   */
  getPrDiscussionsStatus(
    owner: string,
    repo: string,
    number: number,
  ): Observable<{
    totalThreads: number;
    unresolvedThreads: Array<{ isResolved: boolean; lastCommentAuthor: string }>;
  }> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(last: 100) {
              totalCount
              nodes {
                isResolved
                comments(last: 1) {
                  nodes {
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    return this.http
      .post<any>(`${API_BASE}/graphql`, { query, variables: { owner, repo, number } })
      .pipe(
        map((res) => {
          const pr = res?.data?.repository?.pullRequest;
          const threads = pr?.reviewThreads?.nodes || [];
          const totalThreads = pr?.reviewThreads?.totalCount || 0;
          const unresolvedThreads = threads.map((t: any) => ({
            isResolved: t.isResolved,
            lastCommentAuthor: t.comments?.nodes?.[0]?.author?.login || '',
          }));
          return { totalThreads, unresolvedThreads };
        }),
      );
  }
}
