import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { GitHubApiService } from '../../core';
import { CiStatusService } from '../ci-status';
import { AuthService } from '../auth';
import { PullRequestWithStatus, ReviewStatus } from '../../models';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(GitHubApiService);
  private readonly ciService = inject(CiStatusService);
  private readonly auth = inject(AuthService);

  private readonly _prList = signal<PullRequestWithStatus[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _lastRefresh = signal<Date | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _rateLimit = signal<{ remaining: number; limit: number; reset: number } | null>(
    null,
  );
  private readonly _selectedPrId = signal<number | null>(null);
  private readonly _filterAuthor = signal<string | null>(null);

  readonly prList = this._prList.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly lastRefresh = this._lastRefresh.asReadonly();
  readonly error = this._error.asReadonly();
  readonly rateLimit = this._rateLimit.asReadonly();
  readonly selectedPrId = this._selectedPrId.asReadonly();
  readonly filterAuthor = this._filterAuthor.asReadonly();

  readonly selectedPr = computed(() => {
    const id = this._selectedPrId();
    if (id === null) return null;
    return this._prList().find((p) => p.pr.id === id) ?? null;
  });

  readonly stats = computed(() => {
    const list = this._prList();
    return {
      total: list.length,
      passing: list.filter((p) => p.ciStatus === 'success').length,
      failing: list.filter((p) => p.ciStatus === 'failure').length,
      pending: list.filter((p) => p.ciStatus === 'pending').length,
    };
  });

  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private successRefreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const list = this._prList();
      const count = list.filter((p) => p.unseenDiscussions || p.unseenApproval || p.unseenCiFinish).length;
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.setBadgeCount) {
        electronAPI.setBadgeCount(count);
      }
    });
  }

  selectPr(prId: number): void {
    this._selectedPrId.set(prId);
    // Clear notifications for this PR
    this._prList.update((list) => {
      const idx = list.findIndex((p) => p.pr.id === prId);
      if (idx === -1) return list;
      const updated = [...list];
      updated[idx] = {
        ...updated[idx],
        unseenDiscussions: false,
        unseenApproval: false,
        unseenCiFinish: false,
      };
      return updated;
    });
  }

  setFilterAuthor(author: string | null): void {
    this._filterAuthor.set(author);
  }

  /**
   * Initial full load of all PRs.
   */
  async loadPullRequests(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;

    this._isLoading.set(true);
    this._error.set(null);

    const author = this._filterAuthor() ?? user.login;

    try {
      const searchResult = await firstValueFrom(this.api.searchUserPullRequests(author, 'rosahealth/rosa'));
      const searchItems = searchResult.items;

      const prWithStatuses: PullRequestWithStatus[] = [];

      for (const item of searchItems) {
        const repoFullName = this.extractRepoFromUrl(item.html_url);
        if (!repoFullName) continue;

        const [owner, repo] = repoFullName.split('/');
        const prNumber = this.extractPrNumber(item.html_url);
        if (!prNumber) continue;

        try {
          const fullPr = await firstValueFrom(this.api.getPullRequest(owner, repo, prNumber));
          prWithStatuses.push({
            pr: fullPr,
            ciStatus: 'pending',
            reviewStatus: 'PENDING',
            isMergeable: false,
            discussionStatus: 'NONE',
            checkRuns: [],
            failedRuns: [],
            failedJobs: [],
            isLoading: true,
            isMerging: false,
            unseenDiscussions: false,
            unseenApproval: false,
            unseenCiFinish: false,
          });
        } catch {
          // Skip PRs we can't access
        }
      }

      this._prList.set(prWithStatuses);
      this._lastRefresh.set(new Date());

      // Auto-select first PR if none selected
      if (this._selectedPrId() === null && prWithStatuses.length > 0) {
        this._selectedPrId.set(prWithStatuses[0].pr.id);
      }

      await this.loadCIStatusForAll();
      this.updateRateLimit();
    } catch (err: any) {
      const msg = err?.error?.message || err?.message || 'Failed to load pull requests.';
      this._error.set(msg);
    }

    this._isLoading.set(false);
  }

  /**
   * Reload CI status for a single PR (manual refresh).
   */
  async reloadSinglePr(prId: number): Promise<void> {
    const index = this._prList().findIndex((p) => p.pr.id === prId);
    if (index === -1) return;

    this._prList.update((list) => {
      const updated = [...list];
      updated[index] = { ...updated[index], isLoading: true };
      return updated;
    });

    try {
      const item = this._prList()[index];
      const [owner, repo] = item.pr.base.repo.full_name.split('/');
      const prNumber = item.pr.number;

      // Reload PR metadata (vitals like Title, Body, Head SHA)
      const updatedPr = await firstValueFrom(this.api.getPullRequest(owner, repo, prNumber));

      this._prList.update((list) => {
        const updated = [...list];
        updated[index] = { ...updated[index], pr: updatedPr };
        return updated;
      });

      // Reload Status (CI, Reviews, Discussions)
      await this.loadCIStatusForIndex(index);
    } catch (err: any) {
      this._prList.update((list) => {
        const updated = [...list];
        updated[index] = { ...updated[index], isLoading: false };
        return updated;
      });
      const msg = err?.error?.message || err?.message || 'Failed to reload PR.';
      this._error.set(msg);
    }

    this.updateRateLimit();
  }

  /**
   * Merge a pull request.
   */
  async mergePr(prId: number): Promise<void> {
    const prIndex = this._prList().findIndex((p) => p.pr.id === prId);
    if (prIndex === -1) return;

    const item = this._prList()[prIndex];
    const [owner, repo] = item.pr.base.repo.full_name.split('/');

    // Set isMerging = true
    this._prList.update((list) => {
      const updated = [...list];
      updated[prIndex] = { ...updated[prIndex], isMerging: true };
      return updated;
    });

    try {
      await firstValueFrom(this.api.mergePullRequest(owner, repo, item.pr.number));

      // Remove PR from list immediately
      const remainingPrs = this._prList().filter((p) => p.pr.id !== prId);
      this._prList.set(remainingPrs);

      // If the merged PR was currently selected, select another one
      if (this._selectedPrId() === prId) {
        this._selectedPrId.set(remainingPrs.length > 0 ? remainingPrs[0].pr.id : null);
      }
    } catch (err: any) {
      const msg = err?.error?.message || err?.message || 'Failed to merge pull request.';
      this._error.set(msg);

      // Clear merging state on error
      this._prList.update((list) => {
        const currentIdx = list.findIndex((p) => p.pr.id === prId);
        if (currentIdx === -1) return list;
        const updated = [...list];
        updated[currentIdx] = { ...updated[currentIdx], isMerging: false };
        return updated;
      });
    }
  }

  /**
   * Auto-refresh: only re-poll PRs that are in "pending" (running) status.
   */
  async refreshPendingPrs(): Promise<void> {
    const list = this._prList();
    const pendingIndices = list
      .map((item, i) => (item.ciStatus === 'pending' ? i : -1))
      .filter((i) => i !== -1);

    if (pendingIndices.length === 0) return;

    for (const idx of pendingIndices) {
      this._prList.update((l) => {
        const updated = [...l];
        updated[idx] = { ...updated[idx], isLoading: true };
        return updated;
      });
    }

    await Promise.allSettled(pendingIndices.map((idx) => this.loadCIStatusForIndex(idx)));
    this._lastRefresh.set(new Date());
    this.updateRateLimit();
  }

  /**
   * Auto-refresh for successful PRs: only refresh review status.
   */
  async refreshSuccessfulPrs(): Promise<void> {
    const list = this._prList();
    const successIndices = list
      .map((item, i) => (item.ciStatus === 'success' ? i : -1))
      .filter((i) => i !== -1);

    if (successIndices.length === 0) return;

    await Promise.allSettled(successIndices.map((idx) => this.loadReviewOnlyForIndex(idx)));
    this.updateRateLimit();
  }

  private async loadReviewOnlyForIndex(index: number): Promise<void> {
    const item = this._prList()[index];
    if (!item) return;

    try {
      const [owner, repo] = item.pr.base.repo.full_name.split('/');
      const [reviews, discussionStatusData] = await Promise.all([
        firstValueFrom(this.api.getReviews(owner, repo, item.pr.number)),
        firstValueFrom(this.api.getPrDiscussionsStatus(owner, repo, item.pr.number)),
      ]);

      const oldItem = this._prList()[index];
      const isSelected = this._selectedPrId() === oldItem.pr.id;

      const newDiscussionStatus = this.computeDiscussionStatus(discussionStatusData.unresolvedThreads);
      const hasOpenDiscussions = newDiscussionStatus !== 'NONE';
      const newReviewStatus = this.computeReviewStatus(reviews, hasOpenDiscussions);

      let unseenApproval = oldItem.unseenApproval;
      let unseenDiscussions = oldItem.unseenDiscussions;

      // Check for approval change
      if (oldItem.reviewStatus !== 'APPROVED' && newReviewStatus === 'APPROVED') {
        if (!isSelected) unseenApproval = true;
      }

      // Check for new discussions
      if (oldItem.discussionStatus !== 'NEW_CONTENT' && newDiscussionStatus === 'NEW_CONTENT') {
        if (!isSelected) unseenDiscussions = true;
      }

      this._prList.update((list) => {
        const updated = [...list];
        updated[index] = {
          ...updated[index],
          reviewStatus: newReviewStatus,
          discussionStatus: newDiscussionStatus,
          unseenApproval,
          unseenDiscussions,
          isMergeable:
            updated[index].ciStatus === 'success' && newReviewStatus === 'APPROVED' && !item.pr.draft,
        };
        return updated;
      });
    } catch {
      // Background refresh failure is non-critical
    }
  }

  /**
   * Rerun all failed workflow runs across ALL failing PRs.
   */
  async rerunAllFailed(): Promise<number> {
    const list = this._prList();
    let rerunCount = 0;

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.ciStatus !== 'failure') continue;

      const runIds = new Set(item.failedJobs.map((j) => j.runId));
      for (const runId of runIds) {
        const repoFullName = item.failedJobs.find((j) => j.runId === runId)?.repoFullName;
        if (repoFullName) {
          const success = await this.rerunFailedJobs(i, runId, repoFullName);
          if (success) rerunCount++;
        }
      }
    }

    return rerunCount;
  }

  /**
   * Rerun failed jobs for a single PR, then mark it as pending.
   */
  async rerunFailedForPr(prId: number): Promise<void> {
    const index = this._prList().findIndex((p) => p.pr.id === prId);
    if (index === -1) return;

    const item = this._prList()[index];
    const runIds = new Set(item.failedJobs.map((j) => j.runId));

    for (const runId of runIds) {
      const repoFullName = item.failedJobs.find((j) => j.runId === runId)?.repoFullName;
      if (repoFullName) {
        await this.rerunFailedJobs(index, runId, repoFullName);
      }
    }
  }

  async rerunFailedJobs(prIndex: number, runId: number, repoFullName: string): Promise<boolean> {
    const [owner, repo] = repoFullName.split('/');
    const success = await this.ciService.rerunFailedJobs(owner, repo, runId);

    if (success) {
      this._prList.update((list) => {
        const updated = [...list];
        updated[prIndex] = {
          ...updated[prIndex],
          ciStatus: 'pending',
          failedJobs: [],
          failedRuns: [],
        };
        return updated;
      });
    }

    return success;
  }

  startAutoRefresh(pendingIntervalMs: number = 15000, successIntervalMs: number = 60000): void {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => this.refreshPendingPrs(), pendingIntervalMs);
    this.successRefreshInterval = setInterval(() => this.refreshSuccessfulPrs(), successIntervalMs);
  }

  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this.successRefreshInterval) {
      clearInterval(this.successRefreshInterval);
      this.successRefreshInterval = null;
    }
  }

  private async loadCIStatusForAll(): Promise<void> {
    const list = this._prList();
    await Promise.allSettled(list.map((_, index) => this.loadCIStatusForIndex(index)));
  }

  private async loadCIStatusForIndex(index: number): Promise<void> {
    const item = this._prList()[index];
    if (!item) return;

    try {
      const repoFullName = item.pr.base.repo.full_name;
      const [owner, repo] = repoFullName.split('/');

      const [checkRuns, reviews, discussionStatusData] = await Promise.all([
        this.ciService.loadCheckRuns(item.pr),
        firstValueFrom(this.api.getReviews(owner, repo, item.pr.number)),
        firstValueFrom(this.api.getPrDiscussionsStatus(owner, repo, item.pr.number)),
      ]);

      const oldItem = this._prList()[index];
      const isSelected = this._selectedPrId() === oldItem.pr.id;

      const newCiStatus = this.ciService.computeCIStatus(checkRuns);
      const newDiscussionStatus = this.computeDiscussionStatus(discussionStatusData.unresolvedThreads);
      const hasOpenDiscussions = newDiscussionStatus !== 'NONE';
      const newReviewStatus = this.computeReviewStatus(reviews, hasOpenDiscussions);

      let unseenCiFinish = oldItem.unseenCiFinish;
      let unseenApproval = oldItem.unseenApproval;
      let unseenDiscussions = oldItem.unseenDiscussions;

      // Check for CI change
      if (oldItem.ciStatus === 'pending' && (newCiStatus === 'success' || newCiStatus === 'failure')) {
        if (!isSelected) unseenCiFinish = true;
      }

      // Check for approval change
      if (oldItem.reviewStatus !== 'APPROVED' && newReviewStatus === 'APPROVED') {
        if (!isSelected) unseenApproval = true;
      }

      // Check for new discussions
      if (oldItem.discussionStatus !== 'NEW_CONTENT' && newDiscussionStatus === 'NEW_CONTENT') {
        if (!isSelected) unseenDiscussions = true;
      }

      let failedRuns = item.failedRuns;
      let failedJobs = item.failedJobs;

      if (newCiStatus === 'failure') {
        failedRuns = await this.ciService.loadFailedWorkflowRuns(item.pr);
        failedJobs = await this.ciService.loadFailedJobsWithErrors(item.pr, failedRuns);
      }

      this._prList.update((list) => {
        const updated = [...list];
        updated[index] = {
          ...updated[index],
          checkRuns,
          ciStatus: newCiStatus,
          reviewStatus: newReviewStatus,
          discussionStatus: newDiscussionStatus,
          unseenCiFinish,
          unseenApproval,
          unseenDiscussions,
          isMergeable: newCiStatus === 'success' && newReviewStatus === 'APPROVED' && !item.pr.draft,
          failedRuns,
          failedJobs,
          isLoading: false,
        };
        return updated;
      });
    } catch {
      this._prList.update((list) => {
        const updated = [...list];
        updated[index] = { ...updated[index], ciStatus: 'unknown', isLoading: false };
        return updated;
      });
    }
  }

  private computeDiscussionStatus(
    unresolvedThreads: Array<{ isResolved: boolean; lastCommentAuthor: string }>,
  ): 'NONE' | 'REPLIED' | 'NEW_CONTENT' {
    const unresolved = unresolvedThreads.filter((t) => !t.isResolved);
    if (unresolved.length === 0) return 'NONE';

    const myLogin = this.auth.user()?.login;
    const hasUnreplied = unresolved.some((t) => t.lastCommentAuthor !== myLogin);
    return hasUnreplied ? 'NEW_CONTENT' : 'REPLIED';
  }

  async updatePrMetadata(prId: number, title: string, body: string): Promise<void> {
    const index = this._prList().findIndex((p) => p.pr.id === prId);
    if (index === -1) return;
    const { base, number } = this._prList()[index].pr;
    const owner = base.repo.owner.login;
    const repo = base.repo.name;
    const updated = await firstValueFrom(this.api.updatePullRequest(owner, repo, number, title, body));
    this._prList.update((list) => {
      const copy = [...list];
      copy[index] = { ...copy[index], pr: { ...copy[index].pr, title: updated.title, body: updated.body } };
      return copy;
    });
  }

  private computeReviewStatus(reviews: any[], hasOpenDiscussions: boolean): ReviewStatus {
    if (reviews.length === 0) {
      return hasOpenDiscussions ? 'PENDING' : 'PENDING'; // Wait, if no reviews, it's pending.
    }

    const lastReviews = new Map<string, string>();
    for (const r of reviews) {
      lastReviews.set(r.user.login, r.state);
    }

    const states = Array.from(lastReviews.values());
    if (states.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
    if (states.includes('APPROVED')) return 'APPROVED';
    if (states.includes('DISMISSED')) return 'DISMISSED';
    return 'PENDING';
  }

  private async updateRateLimit(): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.getRateLimit());
      this._rateLimit.set(result.resources.core);
    } catch {
      // non-critical
    }
  }

  private extractRepoFromUrl(url: string): string | null {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
    return match ? match[1] : null;
  }

  private extractPrNumber(url: string): number | null {
    const match = url.match(/\/pull\/(\d+)/);
    if (!match) {
      const issueMatch = url.match(/\/issues\/(\d+)/);
      return issueMatch ? parseInt(issueMatch[1], 10) : null;
    }
    return parseInt(match[1], 10);
  }
}
