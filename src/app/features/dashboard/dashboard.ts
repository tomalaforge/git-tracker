import { Component, inject, OnInit, OnDestroy, signal, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DashboardService } from './dashboard.service';
import { PrSidebarItemComponent } from './pr-sidebar-item';
import { PrDetailComponent } from './pr-detail';
import { AuthService } from '../auth';

@Component({
  selector: 'gt-dashboard',
  standalone: true,
  imports: [PrSidebarItemComponent, PrDetailComponent, DatePipe, FormsModule],
  template: `
    <div class="h-screen flex flex-col">
      @if (auth.isValidating()) {
        <!-- Auth validation loading screen -->
        <div class="flex-1 flex flex-col items-center justify-center bg-bg-primary gap-4">
          <div class="relative w-16 h-16">
            <div class="absolute inset-0 rounded-2xl bg-accent/20 animate-ping"></div>
            <div class="absolute inset-0 rounded-2xl bg-bg-glass border-2 border-accent/50 flex items-center justify-center">
              <svg class="w-8 h-8 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          </div>
          <div class="text-center">
            <h2 class="text-lg font-bold text-text-primary tracking-tight">Validating session</h2>
            <p class="text-sm text-text-muted mt-1">Please wait a moment…</p>
          </div>
          
          <!-- Emergency Logout -->
          <button 
            (click)="onLogout()"
            class="mt-8 px-4 py-2 text-xs font-medium text-text-muted hover:text-danger transition-colors underline decoration-dotted cursor-pointer">
            Cancel and logout
          </button>
        </div>
      } @else {
        <!-- Header -->
        <header class="shrink-0 bg-bg-primary/80 backdrop-blur-xl border-b border-border-glass z-50">
          <div class="px-6 py-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-6">
                <div class="flex items-center gap-3">
                  <div
                    class="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
                    <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h1 class="text-sm font-bold text-text-primary tracking-tight leading-none">GitTracker</h1>
                    <p class="text-[10px] text-text-muted mt-0.5">{{ auth.user()?.login }}</p>
                  </div>
                </div>

                <!-- Stats pills next to title -->
                <div class="hidden sm:flex items-center gap-1.5 border-l border-border-glass pl-6">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-bg-glass border border-border-glass text-text-secondary uppercase tracking-tight">
                    {{ dashboard.stats().total }} PR
                  </span>
                  @if (dashboard.stats().passing > 0) {
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-success-bg border border-success-border text-success uppercase tracking-tight">
                      {{ dashboard.stats().passing }} Success
                    </span>
                  }
                  @if (dashboard.stats().failing > 0) {
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-danger-bg border border-danger-border text-danger uppercase tracking-tight">
                      {{ dashboard.stats().failing }} Fails
                    </span>
                  }
                  @if (dashboard.stats().pending > 0) {
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-pending-bg border border-pending-border text-pending uppercase tracking-tight">
                      {{ dashboard.stats().pending }} Running
                    </span>
                  }
                </div>
              </div>

              <div class="flex items-center gap-2">
                <!-- Rate limit -->
                @if (dashboard.rateLimit()) {
                  <span class="hidden md:block text-[11px] text-text-muted" [title]="'X-RateLimit-Limit: ' + dashboard.rateLimit()!.limit">
                    ⚡ {{ dashboard.rateLimit()!.remaining }}/{{ dashboard.rateLimit()!.limit }}
                  </span>
                }

                <!-- Last refresh -->
                @if (dashboard.lastRefresh()) {
                  <span class="hidden lg:block text-[11px] text-text-muted">
                    {{ dashboard.lastRefresh() | date:'HH:mm:ss' }}
                  </span>
                }

                <!-- Refresh all -->
                <button
                  (click)="onRefreshAll()"
                  [disabled]="dashboard.isLoading()"
                  class="p-1.5 rounded-lg bg-bg-glass border border-border-glass hover:border-border-hover
                         text-text-secondary hover:text-text-primary transition-all cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                  title="Reload all PRs">
                  <svg class="w-4 h-4" [class.animate-spin-slow]="dashboard.isLoading()"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>

                <!-- User avatar + logout -->
                @if (auth.token()) {
                  <div class="flex items-center gap-2 pl-2 border-l border-border-glass">
                    @if (auth.user()) {
                      <img
                        [src]="auth.user()!.avatar_url"
                        [alt]="auth.user()!.login"
                        class="w-7 h-7 rounded-full border border-border-glass" />
                    }
                    <button
                      (click)="onLogout()"
                      class="text-[11px] text-text-muted hover:text-danger transition-colors cursor-pointer">
                      Logout
                    </button>
                  </div>
                }
              </div>
            </div>
          </div>
        </header>

        <!-- Error message -->
        @if (dashboard.error()) {
          <div class="shrink-0 mx-4 mt-3 flex items-center gap-2 px-4 py-3 bg-danger-bg border border-danger-border rounded-xl text-danger text-sm animate-fade-in">
            <svg class="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clip-rule="evenodd" />
            </svg>
            {{ dashboard.error() }}
          </div>
        }

        <!-- Split pane: sidebar + detail -->
        <div class="flex-1 flex min-h-0">
          <!-- LEFT SIDEBAR — PR list -->
          <div class="w-[360px] shrink-0 border-r border-border-glass flex flex-col bg-bg-secondary/30">
            <!-- Sidebar header -->
            <div class="shrink-0 px-4 py-2.5 border-b border-border-glass flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-text-secondary uppercase tracking-wider">Pull Requests</span>
                @if (dashboard.prList().length > 0) {
                  <span class="text-[10px] text-pending animate-pulse-slow">
                    @if (dashboard.stats().pending > 0) {
                      ● running: 15s · others: 60s
                    } @else {
                      ● checks every minute
                    }
                  </span>
                }
              </div>
              <!-- Author filter -->
              <div class="flex items-center gap-1.5">
                <input
                  type="text"
                  [(ngModel)]="authorFilterInput"
                  (keydown.enter)="onApplyAuthorFilter()"
                  placeholder="Filter by author…"
                  class="flex-1 min-w-0 px-2.5 py-1 text-[11px] rounded-lg bg-bg-glass border border-border-glass
                         text-text-primary placeholder-text-muted focus:outline-none focus:border-indigo-500
                         transition-colors" />
                <button
                  (click)="onApplyAuthorFilter()"
                  class="px-2 py-1 text-[11px] font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700
                         text-white transition-colors cursor-pointer active:scale-95 shrink-0">
                  OK
                </button>
                @if (dashboard.filterAuthor()) {
                  <button
                    (click)="onClearAuthorFilter()"
                    class="px-2 py-1 text-[11px] font-medium rounded-lg bg-bg-glass border border-border-glass
                           text-text-secondary hover:text-danger hover:border-danger transition-colors cursor-pointer active:scale-95 shrink-0">
                    ✕
                  </button>
                }
              </div>
            </div>

            <!-- PR list - scrollable -->
            <div class="flex-1 overflow-y-auto">
              @if (dashboard.isLoading() && dashboard.prList().length === 0) {
                <!-- Loading skeletons -->
                @for (i of [1, 2, 3, 4]; track i) {
                  <div class="px-4 py-3 border-b border-border-glass animate-pulse-slow">
                    <div class="h-2.5 bg-bg-glass rounded w-1/3 mb-2"></div>
                    <div class="h-4 bg-bg-glass rounded w-4/5 mb-2"></div>
                    <div class="h-2.5 bg-bg-glass rounded w-1/2"></div>
                  </div>
                }
              }

              @for (prItem of dashboard.prList(); track prItem.pr.id) {
                <gt-pr-sidebar-item
                  [prData]="prItem"
                  [isSelected]="dashboard.selectedPrId() === prItem.pr.id"
                  (select)="dashboard.selectPr(prItem.pr.id)" />
              }

              @if (!dashboard.isLoading() && dashboard.prList().length === 0 && !dashboard.error()) {
                <div class="px-4 py-12 text-center">
                  <p class="text-sm text-text-muted">No open PRs</p>
                </div>
              }
            </div>
          </div>

          <!-- RIGHT PANEL — PR detail -->
          <div class="flex-1 min-w-0 bg-bg-primary">
            @if (dashboard.selectedPr()) {
              <gt-pr-detail
                [pr]="dashboard.selectedPr()!"
                (reload)="onReloadPr(dashboard.selectedPr()!.pr.id)"
                (merge)="onMergePr(dashboard.selectedPr()!.pr.id)"
                (rerunAllFailed)="onRerunFailedForPr(dashboard.selectedPr()!.pr.id)"
                (rerunJob)="onRerunSingleJob($event)"
                (prDetailsUpdated)="onPrDetailsUpdated(dashboard.selectedPr()!.pr.id, $event)" />
            } @else {
              <!-- No PR selected -->
              <div class="h-full flex items-center justify-center">
                <div class="text-center">
                  <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-bg-glass border border-border-glass mb-4">
                    <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                    </svg>
                  </div>
                  <p class="text-sm text-text-muted">Select a PR to see details</p>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly dashboard = inject(DashboardService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  authorFilterInput = '';

  constructor() {
    // Re-validate or start loading PRs only when authenticated
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.dashboard.loadPullRequests();
        this.dashboard.startAutoRefresh(15000, 60000);
      } else if (!this.auth.isValidating()) {
        this.dashboard.stopAutoRefresh();
      }
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.dashboard.stopAutoRefresh();
  }

  onRefreshAll(): void {
    this.dashboard.loadPullRequests();
  }

  onApplyAuthorFilter(): void {
    const trimmed = this.authorFilterInput.trim();
    this.dashboard.setFilterAuthor(trimmed || null);
    this.dashboard.loadPullRequests();
  }

  onClearAuthorFilter(): void {
    this.authorFilterInput = '';
    this.dashboard.setFilterAuthor(null);
    this.dashboard.loadPullRequests();
  }

  onReloadPr(prId: number): void {
    this.dashboard.reloadSinglePr(prId);
  }

  async onMergePr(prId: number): Promise<void> {
    if (confirm('Are you sure you want to merge this pull request?')) {
      await this.dashboard.mergePr(prId);
    }
  }

  async onRerunAllFailed(): Promise<void> {
    await this.dashboard.rerunAllFailed();
  }

  async onRerunFailedForPr(prId: number): Promise<void> {
    await this.dashboard.rerunFailedForPr(prId);
  }

  async onRerunSingleJob(event: { runId: number; repoFullName: string }): Promise<void> {
    const selectedPr = this.dashboard.selectedPr();
    if (!selectedPr) return;

    const index = this.dashboard.prList().findIndex(p => p.pr.id === selectedPr.pr.id);
    if (index !== -1) {
      await this.dashboard.rerunFailedJobs(index, event.runId, event.repoFullName);
    }
  }

  async onPrDetailsUpdated(prId: number, event: { title: string; body: string }): Promise<void> {
    await this.dashboard.updatePrMetadata(prId, event.title, event.body);
  }

  onLogout(): void {
    this.auth.logout();
    this.dashboard.stopAutoRefresh();
    this.router.navigate(['/login']);
  }
}
