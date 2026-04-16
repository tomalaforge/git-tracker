import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { GitHubApiService } from '../../core';
import { CiStatusService } from '../ci-status';
import { AuthService } from '../auth';
import { CIStatus, CheckRun, PullRequest, PullRequestWithStatus, ReviewStatus } from '../../models';
import { firstValueFrom } from 'rxjs';

type DiscussionStatus = PullRequestWithStatus['discussionStatus'];

interface PrActivitySnapshot {
  checkRuns: CheckRun[];
  ciStatus: CIStatus;
  reviewStatus: ReviewStatus;
  discussionStatus: DiscussionStatus;
  latestCommentFingerprint: string | null;
  latestCommentAuthor: string | null;
}

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

  private pendingRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private activityRefreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.requestNotificationPermission();

    effect(() => {
      const list = this._prList();
      const count = list.filter((p) => p.unseenDiscussions || p.unseenApproval || p.unseenCiFinish).length;
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.setBadgeCount) {
        electronAPI.setBadgeCount(count);
      }
    });
  }

  private requestNotificationPermission(): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') {
      return;
    }

    void Notification.requestPermission().catch(() => undefined);
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
            latestCommentFingerprint: null,
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
   * Fast refresh for PRs with running CI.
   */
  async refreshPendingPrActivity(): Promise<void> {
    const list = this._prList();
    const pendingIndices = list
      .map((item, index) => (item.ciStatus === 'pending' ? index : -1))
      .filter((index) => index !== -1);

    if (pendingIndices.length === 0) return;

    await Promise.allSettled(pendingIndices.map((index) => this.pollPrActivityForIndex(index)));
    this._lastRefresh.set(new Date());
    this.updateRateLimit();
  }

  /**
   * Slow refresh for non-pending PRs, to discover state changes without
   * constantly re-rendering cards.
   */
  async refreshPrActivity(): Promise<void> {
    const list = this._prList();
    const nonPendingIndices = list
      .map((item, index) => (item.ciStatus !== 'pending' ? index : -1))
      .filter((index) => index !== -1);

    if (nonPendingIndices.length === 0) return;

    await Promise.allSettled(nonPendingIndices.map((index) => this.pollPrActivityForIndex(index)));
    this._lastRefresh.set(new Date());
    this.updateRateLimit();
  }

  private async pollPrActivityForIndex(index: number): Promise<void> {
    const item = this._prList()[index];
    if (!item) return;

    try {
      const [owner, repo] = item.pr.base.repo.full_name.split('/');
      const latestPr = await firstValueFrom(this.api.getPullRequest(owner, repo, item.pr.number));
      const snapshot = await this.loadActivitySnapshot(latestPr);

      const currentItem = this._prList()[index];
      if (!currentItem || currentItem.pr.id !== item.pr.id) return;

      const headChanged = currentItem.pr.head.sha !== latestPr.head.sha;
      const ciFinished =
        currentItem.ciStatus === 'pending' && (snapshot.ciStatus === 'success' || snapshot.ciStatus === 'failure');
      const approvalGranted = currentItem.reviewStatus !== 'APPROVED' && snapshot.reviewStatus === 'APPROVED';
      const newComment = this.hasNewExternalComment(currentItem, snapshot);

      if (!headChanged && !ciFinished && !approvalGranted && !newComment) {
        return;
      }

      await this.applyActivitySnapshot(index, latestPr, snapshot, {
        notifyCiFinish: ciFinished,
        notifyApproval: approvalGranted,
        notifyComment: newComment,
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

  startAutoRefresh(pendingIntervalMs: number = 15000, activityIntervalMs: number = 60000): void {
    this.stopAutoRefresh();
    this.pendingRefreshInterval = setInterval(() => {
      void this.refreshPendingPrActivity();
    }, pendingIntervalMs);
    this.activityRefreshInterval = setInterval(() => {
      void this.refreshPrActivity();
    }, activityIntervalMs);
  }

  stopAutoRefresh(): void {
    if (this.pendingRefreshInterval) {
      clearInterval(this.pendingRefreshInterval);
      this.pendingRefreshInterval = null;
    }
    if (this.activityRefreshInterval) {
      clearInterval(this.activityRefreshInterval);
      this.activityRefreshInterval = null;
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
      const snapshot = await this.loadActivitySnapshot(item.pr);
      await this.applyActivitySnapshot(index, item.pr, snapshot, {
        notifyCiFinish: false,
        notifyApproval: false,
        notifyComment: false,
        forceRefresh: true,
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

  private async loadActivitySnapshot(pr: PullRequest): Promise<PrActivitySnapshot> {
    const [owner, repo] = pr.base.repo.full_name.split('/');

    const [checkRuns, reviews, discussionStatusData, prComments, reviewComments] = await Promise.all([
      this.ciService.loadCheckRuns(pr),
      firstValueFrom(this.api.getReviews(owner, repo, pr.number)),
      firstValueFrom(this.api.getPrDiscussionsStatus(owner, repo, pr.number)),
      firstValueFrom(this.api.getPrComments(owner, repo, pr.number)),
      firstValueFrom(this.api.getPrReviewComments(owner, repo, pr.number)),
    ]);

    const discussionStatus = this.computeDiscussionStatus(discussionStatusData.unresolvedThreads);
    const reviewStatus = this.computeReviewStatus(reviews, discussionStatus !== 'NONE');
    const latestComment = this.findLatestComment(prComments, reviewComments, reviews);

    return {
      checkRuns,
      ciStatus: this.ciService.computeCIStatus(checkRuns),
      reviewStatus,
      discussionStatus,
      latestCommentFingerprint: latestComment?.fingerprint ?? null,
      latestCommentAuthor: latestComment?.author ?? null,
    };
  }

  private async applyActivitySnapshot(
    index: number,
    pr: PullRequest,
    snapshot: PrActivitySnapshot,
    options: {
      notifyCiFinish: boolean;
      notifyApproval: boolean;
      notifyComment: boolean;
      forceRefresh?: boolean;
    },
  ): Promise<void> {
    const currentItem = this._prList()[index];
    if (!currentItem) return;

    const isSelected = this._selectedPrId() === currentItem.pr.id;

    let failedRuns = currentItem.failedRuns;
    let failedJobs = currentItem.failedJobs;

    if (snapshot.ciStatus === 'failure') {
      failedRuns = await this.ciService.loadFailedWorkflowRuns(pr);
      failedJobs = await this.ciService.loadFailedJobsWithErrors(pr, failedRuns);
    } else if (currentItem.failedRuns.length > 0 || currentItem.failedJobs.length > 0) {
      failedRuns = [];
      failedJobs = [];
    }

    const unseenCiFinish = options.notifyCiFinish && !isSelected ? true : currentItem.unseenCiFinish;
    const unseenApproval = options.notifyApproval && !isSelected ? true : currentItem.unseenApproval;
    const unseenDiscussions = options.notifyComment && !isSelected ? true : currentItem.unseenDiscussions;

    const nextItem: PullRequestWithStatus = {
      ...currentItem,
      pr,
      checkRuns: snapshot.checkRuns,
      ciStatus: snapshot.ciStatus,
      reviewStatus: snapshot.reviewStatus,
      discussionStatus: snapshot.discussionStatus,
      latestCommentFingerprint: snapshot.latestCommentFingerprint,
      unseenCiFinish,
      unseenApproval,
      unseenDiscussions,
      isMergeable: snapshot.ciStatus === 'success' && snapshot.reviewStatus === 'APPROVED' && !pr.draft,
      failedRuns,
      failedJobs,
      isLoading: false,
    };

    const shouldUpdate =
      options.forceRefresh ||
      currentItem.pr !== nextItem.pr ||
      currentItem.ciStatus !== nextItem.ciStatus ||
      currentItem.reviewStatus !== nextItem.reviewStatus ||
      currentItem.discussionStatus !== nextItem.discussionStatus ||
      currentItem.latestCommentFingerprint !== nextItem.latestCommentFingerprint ||
      currentItem.unseenCiFinish !== nextItem.unseenCiFinish ||
      currentItem.unseenApproval !== nextItem.unseenApproval ||
      currentItem.unseenDiscussions !== nextItem.unseenDiscussions ||
      currentItem.isMergeable !== nextItem.isMergeable ||
      currentItem.isLoading !== nextItem.isLoading ||
      currentItem.checkRuns !== nextItem.checkRuns ||
      currentItem.failedRuns !== nextItem.failedRuns ||
      currentItem.failedJobs !== nextItem.failedJobs;

    if (!shouldUpdate) return;

    this._prList.update((list) => {
      const updated = [...list];
      const latestItem = updated[index];
      if (!latestItem || latestItem.pr.id !== currentItem.pr.id) {
        return list;
      }
      updated[index] = {
        ...latestItem,
        ...nextItem,
      };
      return updated;
    });
  }

  private hasNewExternalComment(item: PullRequestWithStatus, snapshot: PrActivitySnapshot): boolean {
    if (!snapshot.latestCommentFingerprint) return false;
    if (snapshot.latestCommentFingerprint === item.latestCommentFingerprint) return false;

    return snapshot.latestCommentAuthor !== this.auth.user()?.login;
  }

  private findLatestComment(
    prComments: any[],
    reviewComments: any[],
    reviews: any[],
  ): { fingerprint: string; author: string | null } | null {
    const commentLikeReviews = reviews.filter(
      (review) => review.state === 'COMMENTED' && typeof review.body === 'string' && review.body.trim().length > 0,
    );

    const latest = [...prComments, ...reviewComments, ...commentLikeReviews]
      .map((comment) => ({
        id: comment.id,
        author: comment.user?.login ?? null,
        timestamp: comment.updated_at ?? comment.created_at ?? comment.submitted_at ?? null,
      }))
      .filter((comment): comment is { id: number; author: string | null; timestamp: string } => Boolean(comment.timestamp))
      .sort((a, b) => {
        if (a.timestamp === b.timestamp) {
          return b.id - a.id;
        }
        return b.timestamp.localeCompare(a.timestamp);
      })[0];

    if (!latest) return null;

    return {
      fingerprint: `${latest.id}:${latest.timestamp}`,
      author: latest.author,
    };
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
