export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: {
    login: string;
    avatar_url: string;
  };
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
    repo: {
      full_name: string;
      name: string;
      owner: {
        login: string;
      };
    };
  };
  labels: Array<{
    name: string;
    color: string;
  }>;
  draft: boolean;
  mergeable_state?: string;
}

export type CIStatus = 'success' | 'failure' | 'pending' | 'neutral' | 'unknown';

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  started_at: string;
  completed_at: string | null;
  output: {
    title: string | null;
    summary: string | null;
    annotations_count: number;
  };
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_number: number;
  head_sha: string;
  created_at: string;
  updated_at: string;
  repository: {
    full_name: string;
  };
}

export interface WorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  started_at: string;
  completed_at: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
}

export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: string;
  message: string;
  title: string | null;
  raw_details: string | null;
}

export type ReviewStatus = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';

export interface ParsedTestFailure {
  /** Nx project / test suite, e.g. "hp-calendar-feat-settings-account" */
  suite: string;
  /** Nx target, e.g. "component-test" or "test" */
  target: string;
  /** Full test path, e.g. "AccountShell > Contact section > should validate the form" */
  testPath: string[];
  /** The assertion/error message */
  errorMessage: string;
  /** Expected vs actual diff lines */
  diff: string | null;
}

export interface PullRequestWithStatus {
  pr: PullRequest;
  ciStatus: CIStatus;
  reviewStatus: ReviewStatus;
  isMergeable: boolean;
  checkRuns: CheckRun[];
  failedRuns: WorkflowRun[];
  failedJobs: WorkflowJobWithErrors[];
  isLoading: boolean;
}

export interface WorkflowJobWithErrors {
  job: WorkflowJob;
  annotations: CheckAnnotation[];
  testFailures: ParsedTestFailure[];
  logAccessible: boolean;
  runName: string;
  runId: number;
  repoFullName: string;
}
