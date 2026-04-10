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
      const selectedId = this._selectedPrId();
      const count = list.filter(
        (p) =>
          p.pr.id !== selectedId &&
          (p.unseenDiscussions || p.unseenApproval || p.unseenCiFinish),
      ).length;
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
    const list = this._prList();
    const idx = list.findIndex((p) => p.pr.id === prId);
    if (idx === -1) {
      this._selectedPrId.set(prId);
      return;
    }

    const item = list[idx];
    if (!item.unseenDiscussions && !item.unseenApproval && !item.unseenCiFinish) {
      this._selectedPrId.set(prId);
      return;
    }

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
            ciStatus: 'unknown',
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

      await this.loadCIStatusForAll(false);
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
      await this.loadCIStatusForIndex(index, false);
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
<<<<<<< HEAD
  async refreshPendingPrActivity(): Promise<void> {
    const list = this._prList();
    const pendingIndices = list
      .map((item, index) => (item.ciStatus === 'pending' ? index : -1))
      .filter((index) => index !== -1);

    if (pendingIndices.length === 0) return;

    await Promise.allSettled(pendingIndices.map((index) => this.pollPrActivityForIndex(index)));
    this._lastRefresh.set(new Date());
=======
  async refreshPendingPrs(): Promise<void> {
    const currentList = this._prList();
    const pendingIndices = currentList
      .map((item, i) => (item.ciStatus === 'pending' ? i : -1))
      .filter((i) => i !== -1);

    if (pendingIndices.length === 0) return;

    // Fetch refreshed items in background without showing loader for background sync
    const refreshedPromises = pendingIndices.map((idx) => {
      const item = currentList[idx];
      return this.loadUpdatedPrStatus(item);
    });

    const results = await Promise.allSettled(refreshedPromises);
    
    let hasChanges = false;
    const newList = [...currentList];

    results.forEach((res, i) => {
      const originalIdx = pendingIndices[i];
      if (res.status === 'fulfilled') {
        if (!this.arePrsEffectivelyEqual(newList[originalIdx], res.value)) {
          newList[originalIdx] = res.value;
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      this._prList.set(newList);
      this._lastRefresh.set(new Date());
    }
    
>>>>>>> f5be03b (fix many prop)
    this.updateRateLimit();
  }

  /**
<<<<<<< HEAD
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
=======
   * Sync the PR list: add new PRs, remove merged/closed ones, and refresh status for all.
   * This handles detecting new PRs, removed PRs, and job restarts.
   */
  async syncPullRequests(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;

>>>>>>> f5be03b (fix many prop)
    this.updateRateLimit();

    const author = this._filterAuthor() ?? user.login;
    try {
      const searchResult = await firstValueFrom(this.api.searchUserPullRequests(author, 'rosahealth/rosa'));
      const searchItems = searchResult.items;
      
      const currentPrs = this._prList();
      const currentMap = new Map(currentPrs.map(p => [p.pr.id, p]));
      const searchIds = new Set(searchItems.map(item => item.id));

      // 1. Prepare initial list with most recent PR metadata
      let updatedList: PullRequestWithStatus[] = [];
      const newItems: any[] = [];

      for (const item of searchItems) {
        const existing = currentMap.get(item.id);
        if (existing) {
          // Keep existing but with updated PR vitals (title, body, updated_at)
          updatedList.push({ ...existing, pr: item });
        } else {
          // It's a new PR
          newItems.push(item);
        }
      }

      // 2. Fetch full data for NEW items
      for (const item of newItems) {
        const repoFullName = this.extractRepoFromUrl(item.html_url);
        if (!repoFullName) continue;
        const [owner, repo] = repoFullName.split('/');
        const prNumber = this.extractPrNumber(item.html_url);
        if (!prNumber) continue;

        try {
          const fullPr = await firstValueFrom(this.api.getPullRequest(owner, repo, prNumber));
          updatedList.push({
            pr: fullPr,
            ciStatus: 'unknown',
            reviewStatus: 'PENDING',
            isMergeable: false,
            discussionStatus: 'NONE',
            checkRuns: [],
            failedRuns: [],
            failedJobs: [],
            isLoading: false, // Don't show loader for background sync
            isMerging: false,
            unseenDiscussions: false,
            unseenApproval: false,
            unseenCiFinish: false,
          });
        } catch { /* skip */ }
      }

      // Re-sort if list changed
      updatedList.sort((a, b) => new Date(b.pr.updated_at).getTime() - new Date(a.pr.updated_at).getTime());

      // 3. Refresh status for ALL active PRs in parallel (in-memory)
      // Determine if a PR is new (wasn't in currentMap) vs existing
      const refreshedList = await Promise.all(
        updatedList.map((item) => {
          const isNew = !currentMap.has(item.pr.id);
          return this.loadUpdatedPrStatus(item, !isNew);
        }),
      );

      // 4. Final Comparison for atomic update
      if (this.areListsEffectivelyDifferent(currentPrs, refreshedList)) {
        this._prList.set(refreshedList);
        this._lastRefresh.set(new Date());
      }
    } catch (err) {
      // background sync fail
    }
  }

  private areListsEffectivelyDifferent(a: PullRequestWithStatus[], b: PullRequestWithStatus[]): boolean {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (!this.arePrsEffectivelyEqual(a[i], b[i])) return true;
    }
    return false;
  }

  /**
   * Deeply compares two PullRequestWithStatus objects to avoid unnecessary UI updates.
   */
  private arePrsEffectivelyEqual(a: PullRequestWithStatus, b: PullRequestWithStatus): boolean {
    // 1. Meta-data
    if (a.pr.updated_at !== b.pr.updated_at) return false;
    if (a.pr.head.sha !== b.pr.head.sha) return false;
    if (a.pr.title !== b.pr.title) return false;
    
    // 2. Statuses
    if (a.ciStatus !== b.ciStatus) return false;
    if (a.reviewStatus !== b.reviewStatus) return false;
    if (a.discussionStatus !== b.discussionStatus) return false;
    if (a.isMergeable !== b.isMergeable) return false;
    
    // 3. Unseen flags
    if (a.unseenApproval !== b.unseenApproval) return false;
    if (a.unseenCiFinish !== b.unseenCiFinish) return false;
    if (a.unseenDiscussions !== b.unseenDiscussions) return false;

    // 4. Loading/Merging state
    if (a.isLoading !== b.isLoading) return false;
    if (a.isMerging !== b.isMerging) return false;

    // 5. Detailed data (Check runs, etc.)
    if (a.checkRuns.length !== b.checkRuns.length) return false;
    
    // Quick check for runner status changes
    for (let i = 0; i < a.checkRuns.length; i++) {
        if (a.checkRuns[i].status !== b.checkRuns[i].status || 
            a.checkRuns[i].conclusion !== b.checkRuns[i].conclusion) return false;
    }

    return true;
  }

  /**
   * Fetch refreshed status for a PR without touching the signal.
   * Returns a NEW object with the latest status.
   */
  private async loadUpdatedPrStatus(
    item: PullRequestWithStatus,
    triggerNotifications = true,
  ): Promise<PullRequestWithStatus> {
    try {
      const repoFullName = item.pr.base.repo.full_name;
      const [owner, repo] = repoFullName.split('/');

      const [checkRuns, reviews, discussionStatusData] = await Promise.all([
        this.ciService.loadCheckRuns(item.pr),
        firstValueFrom(this.api.getReviews(owner, repo, item.pr.number)),
        firstValueFrom(this.api.getPrDiscussionsStatus(owner, repo, item.pr.number)),
      ]);

      const isSelected = this._selectedPrId() === item.pr.id;

      const newCiStatus = this.ciService.computeCIStatus(checkRuns);
      const newDiscussionStatus = this.computeDiscussionStatus(discussionStatusData.unresolvedThreads);
      const hasOpenDiscussions = newDiscussionStatus !== 'NONE';
      const newReviewStatus = this.computeReviewStatus(reviews, hasOpenDiscussions);

      let unseenCiFinish = item.unseenCiFinish;
      let unseenApproval = item.unseenApproval;
      let unseenDiscussions = item.unseenDiscussions;

      // Check for CI change
      if (
        triggerNotifications &&
        item.ciStatus !== 'unknown' &&
        item.ciStatus !== newCiStatus &&
        (newCiStatus === 'success' || newCiStatus === 'failure')
      ) {
        unseenCiFinish = !isSelected;
        if (unseenCiFinish) this.showNotification('CI Finished', `PR #${item.pr.number} is now ${newCiStatus}`);
      }

      // Check for approval change
      if (
        triggerNotifications && 
        item.reviewStatus !== 'APPROVED' && 
        newReviewStatus === 'APPROVED'
      ) {
        unseenApproval = !isSelected;
        if (unseenApproval) this.showNotification('PR Approved', `PR #${item.pr.number} has been approved`);
      }

      // Check for new discussions
      if (
        triggerNotifications &&
        item.discussionStatus !== 'NEW_CONTENT' &&
        newDiscussionStatus === 'NEW_CONTENT'
      ) {
        unseenDiscussions = !isSelected;
        if (unseenDiscussions) this.showNotification('New Message', `New unresolved discussion on PR #${item.pr.number}`);
      }

      // If selected, always clear flags
      if (isSelected) {
        unseenCiFinish = false;
        unseenApproval = false;
        unseenDiscussions = false;
      }

      let failedRuns = item.failedRuns;
      let failedJobs = item.failedJobs;

      if (checkRuns.some(cr => cr.conclusion === 'failure')) {
        failedRuns = await this.ciService.loadFailedWorkflowRuns(item.pr);
        failedJobs = await this.ciService.loadFailedJobsWithErrors(item.pr, failedRuns);
      }

      return {
        ...item,
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
    } catch {
      // Preserve existing status on error rather than resetting to 'unknown'
      // This prevents 'ghost' notifications when the next fetch succeeds
      return { ...item, isLoading: false };
    }
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

<<<<<<< HEAD
      if (!headChanged && !ciFinished && !approvalGranted && !newComment) {
        return;
      }

      await this.applyActivitySnapshot(index, latestPr, snapshot, {
        notifyCiFinish: ciFinished,
        notifyApproval: approvalGranted,
        notifyComment: newComment,
=======
      let unseenApproval = oldItem.unseenApproval;
      let unseenDiscussions = oldItem.unseenDiscussions;

      // Check for approval change
      if (oldItem.reviewStatus !== 'APPROVED' && newReviewStatus === 'APPROVED') {
        unseenApproval = !isSelected;
      }

      // Check for new discussions
      if (oldItem.discussionStatus !== 'NEW_CONTENT' && newDiscussionStatus === 'NEW_CONTENT') {
        unseenDiscussions = !isSelected;
      }

      // If selected, always clear flags
      if (isSelected) {
        unseenApproval = false;
        unseenDiscussions = false;
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
>>>>>>> f5be03b (fix many prop)
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

<<<<<<< HEAD
  startAutoRefresh(pendingIntervalMs: number = 15000, activityIntervalMs: number = 60000): void {
    this.stopAutoRefresh();
    this.pendingRefreshInterval = setInterval(() => {
      void this.refreshPendingPrActivity();
    }, pendingIntervalMs);
    this.activityRefreshInterval = setInterval(() => {
      void this.refreshPrActivity();
    }, activityIntervalMs);
=======
  startAutoRefresh(pendingIntervalMs: number = 15000, syncIntervalMs: number = 60000): void {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => this.refreshPendingPrs(), pendingIntervalMs);
    this.successRefreshInterval = setInterval(() => this.syncPullRequests(), syncIntervalMs);
>>>>>>> f5be03b (fix many prop)
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

  private async loadCIStatusForAll(triggerNotifications = true): Promise<void> {
    const list = this._prList();
    await Promise.allSettled(list.map((_, index) => this.loadCIStatusForIndex(index, triggerNotifications)));
  }

  private async loadCIStatusForIndex(index: number, triggerNotifications = true): Promise<void> {
    const item = this._prList()[index];
    if (!item) return;

    try {
<<<<<<< HEAD
      const snapshot = await this.loadActivitySnapshot(item.pr);
      await this.applyActivitySnapshot(index, item.pr, snapshot, {
        notifyCiFinish: false,
        notifyApproval: false,
        notifyComment: false,
        forceRefresh: true,
=======
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
      if (
        triggerNotifications &&
        oldItem.ciStatus !== newCiStatus &&
        (newCiStatus === 'success' || newCiStatus === 'failure')
      ) {
        unseenCiFinish = !isSelected;
        if (unseenCiFinish) this.showNotification('CI Finished', `PR #${item.pr.number} is now ${newCiStatus}`);
      }

      // Check for approval change
      if (triggerNotifications && oldItem.reviewStatus !== 'APPROVED' && newReviewStatus === 'APPROVED') {
        unseenApproval = !isSelected;
        if (unseenApproval) this.showNotification('PR Approved', `PR #${item.pr.number} has been approved`);
      }

      // Check for new discussions
      if (
        triggerNotifications &&
        oldItem.discussionStatus !== 'NEW_CONTENT' &&
        newDiscussionStatus === 'NEW_CONTENT'
      ) {
        unseenDiscussions = !isSelected;
        if (unseenDiscussions) this.showNotification('New Message', `New unresolved discussion on PR #${item.pr.number}`);
      }

      // If selected, always clear flags
      if (isSelected) {
        unseenCiFinish = false;
        unseenApproval = false;
        unseenDiscussions = false;
      }

      let failedRuns = item.failedRuns;
      let failedJobs = item.failedJobs;

      if (checkRuns.some(cr => cr.conclusion === 'failure')) {
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
>>>>>>> f5be03b (fix many prop)
      });
    } catch {
      this._prList.update((list) => {
        const updated = [...list];
        if (updated[index]) {
          updated[index] = { ...updated[index], isLoading: false };
        }
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

  private showNotification(title: string, body: string): void {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          new Notification(title, { body });
        }
      });
    }
  }
}
