import { Component, input, output, computed, signal, inject, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PullRequestWithStatus, WorkflowJobWithErrors, CheckAnnotation, ParsedTestFailure } from '../../models';
import { CiBadgeComponent } from '../ci-status/ci-badge';
import { GitHubApiService } from '../../core';
import { firstValueFrom } from 'rxjs';

interface ReviewThread {
  rootId: number;
  path: string;
  line: number | null;
  diffHunk: string | null;
  comments: any[];
}

@Component({
  selector: 'gt-pr-detail',
  standalone: true,
  imports: [CiBadgeComponent, DatePipe, FormsModule],
  template: `
    <div class="h-full flex flex-col">
      <!-- PR header -->
      <div class="shrink-0 px-6 py-5 border-b border-border-glass bg-bg-card/50">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs text-text-muted font-mono">
                {{ pr().pr.base.repo.full_name }}#{{ pr().pr.number }}
              </span>
              @if (pr().pr.draft) {
                <span class="px-1.5 py-0.5 text-[10px] font-medium text-text-muted bg-bg-glass border border-border-glass rounded">DRAFT</span>
              }
            </div>
            <a [href]="pr().pr.html_url" target="_blank" rel="noopener noreferrer"
              class="text-lg font-semibold text-text-primary hover:text-accent transition-colors leading-snug">
              {{ pr().pr.title }}
            </a>
            <div class="flex items-center gap-3 mt-2 text-xs text-text-muted">
              <span class="flex items-center gap-1 font-mono">
                {{ pr().pr.head.ref }} → {{ pr().pr.base.ref }}
              </span>
              <span>{{ pr().pr.updated_at | date:'MMM d, HH:mm' }}</span>
              <span>{{ pr().checkRuns.length }} check{{ pr().checkRuns.length !== 1 ? 's' : '' }}</span>
              <span class="flex items-center gap-1">
                @switch (pr().reviewStatus) {
                  @case ('APPROVED') {
                    <span class="text-success flex items-center gap-1 font-medium">
                      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
                      Approved
                    </span>
                  }
                  @case ('CHANGES_REQUESTED') {
                    <span class="text-danger flex items-center gap-1 font-medium">
                      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                      Changes Requested
                    </span>
                  }
                  @default {
                    <span class="text-text-muted flex items-center gap-1">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                      Pending Review
                    </span>
                  }
                }
              </span>
            </div>
            @if (pr().pr.labels.length > 0) {
              <div class="flex flex-wrap gap-1.5 mt-2">
                @for (label of pr().pr.labels; track label.name) {
                  <span
                    class="px-2 py-0.5 text-[10px] font-medium rounded-full border"
                    [style.color]="'#' + label.color"
                    [style.border-color]="'#' + label.color + '40'"
                    [style.background-color]="'#' + label.color + '15'">
                    {{ label.name }}
                  </span>
                }
              </div>
            }
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            <gt-ci-badge [status]="pr().ciStatus" />
            <div class="flex items-center gap-1.5">
              <!-- Merge button -->
              @if (pr().isMergeable) {
                <button
                  (click)="merge.emit()"
                  class="px-3 py-1.5 text-[11px] font-bold bg-success text-white rounded-lg hover:bg-success/90 transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 shadow-lg shadow-success/20">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h3m0 0a2 2 0 002-2v-3m-2 2l-3-3m3 3l3-3" />
                  </svg>
                  Merge PR
                </button>
              }
              <!-- Reload this PR -->
              <button
                (click)="reload.emit()"
                class="p-1.5 rounded-lg bg-bg-glass border border-border-glass hover:border-border-hover
                       text-text-muted hover:text-text-primary transition-all cursor-pointer active:scale-95"
                title="Reload CI status">
                <svg class="w-3.5 h-3.5" [class.animate-spin-slow]="pr().isLoading"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <!-- Copy PR link -->
              <button
                (click)="copyPrLink()"
                class="p-1.5 rounded-lg bg-bg-glass border border-border-glass hover:border-border-hover
                       text-text-muted hover:text-text-primary transition-all cursor-pointer active:scale-95"
                [title]="copied() ? 'Copied!' : 'Copy PR link'">
                @if (copied()) {
                  <svg class="w-3.5 h-3.5 text-success" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clip-rule="evenodd" />
                  </svg>
                } @else {
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                }
              </button>
              <!-- Link to GitHub -->
              <a [href]="pr().pr.html_url" target="_blank" rel="noopener noreferrer"
                class="p-1.5 rounded-lg bg-bg-glass border border-border-glass hover:border-border-hover
                       text-text-muted hover:text-text-primary transition-all"
                title="View on GitHub">
                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="shrink-0 flex border-b border-border-glass bg-bg-primary/30">
        <button
          (click)="activeTab.set('ci')"
          class="px-5 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2"
          [class.border-accent]="activeTab() === 'ci'"
          [class.text-accent]="activeTab() === 'ci'"
          [class.border-transparent]="activeTab() !== 'ci'"
          [class.text-text-muted]="activeTab() !== 'ci'"
          [class.hover:text-text-primary]="activeTab() !== 'ci'">
          CI
        </button>
        <button
          (click)="switchToConversations()"
          class="px-5 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2 flex items-center gap-1.5"
          [class.border-accent]="activeTab() === 'conversations'"
          [class.text-accent]="activeTab() === 'conversations'"
          [class.border-transparent]="activeTab() !== 'conversations'"
          [class.text-text-muted]="activeTab() !== 'conversations'"
          [class.hover:text-text-primary]="activeTab() !== 'conversations'">
          Conversations
          @if (totalComments() > 0) {
            <span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              [class.bg-accent]="activeTab() === 'conversations'"
              [class.text-white]="activeTab() === 'conversations'"
              [class.bg-bg-glass]="activeTab() !== 'conversations'"
              [class.text-text-muted]="activeTab() !== 'conversations'">
              {{ totalComments() }}
            </span>
          }
        </button>
        <button
          (click)="activeTab.set('details')"
          class="px-5 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2"
          [class.border-accent]="activeTab() === 'details'"
          [class.text-accent]="activeTab() === 'details'"
          [class.border-transparent]="activeTab() !== 'details'"
          [class.text-text-muted]="activeTab() !== 'details'"
          [class.hover:text-text-primary]="activeTab() !== 'details'">
          Details
        </button>
      </div>

      <!-- Content area - scrollable -->
      <div class="flex-1 overflow-y-auto">
        @if (activeTab() === 'details') {
          <!-- Details tab -->
          <div class="p-6 space-y-5">
            <div class="space-y-1.5">
              <label class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Title</label>
              <input
                [(ngModel)]="editTitle"
                type="text"
                class="w-full px-3 py-2.5 text-sm bg-bg-glass border border-border-glass rounded-xl text-text-primary
                       placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                placeholder="Pull request title" />
            </div>
            <div class="space-y-1.5">
              <label class="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Description</label>
              <textarea
                [(ngModel)]="editBody"
                rows="16"
                class="w-full px-3 py-2.5 text-sm bg-bg-glass border border-border-glass rounded-xl text-text-primary
                       placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                       transition-colors resize-none font-mono leading-relaxed"
                placeholder="Add a description…"></textarea>
            </div>
            <div class="flex items-center gap-3">
              <button
                (click)="saveDetails()"
                [disabled]="isSavingDetails() || !editTitle.trim()"
                class="px-4 py-2 text-xs font-semibold bg-accent text-white rounded-lg
                       hover:bg-accent/90 transition-all cursor-pointer active:scale-95
                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                @if (isSavingDetails()) {
                  <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Saving…
                } @else {
                  Save changes
                }
              </button>
              @if (detailsSaveSuccess()) {
                <span class="text-xs text-success flex items-center gap-1 font-medium">
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                  Saved
                </span>
              }
            </div>
          </div>
        } @else if (activeTab() === 'conversations') {
          <!-- Conversations tab -->
          <div class="flex flex-col h-full">
            @if (isLoadingConversations()) {
              <div class="p-6 space-y-3">
                @for (i of [1,2,3]; track i) {
                  <div class="bg-bg-glass border border-border-glass rounded-xl p-4 animate-pulse-slow">
                    <div class="h-3 bg-bg-card rounded w-1/4 mb-3"></div>
                    <div class="h-3 bg-bg-card rounded w-3/4 mb-2"></div>
                    <div class="h-3 bg-bg-card rounded w-1/2"></div>
                  </div>
                }
              </div>
            } @else {
              <div class="flex-1 overflow-y-auto p-4 space-y-6">

                <!-- Review comment threads grouped by file -->
                @if (reviewThreads().length > 0) {
                  <div>
                    <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wider mb-3">
                      Review Comments ({{ reviewComments().length }})
                    </p>
                    <div class="space-y-4">
                      @for (thread of reviewThreads(); track thread.rootId) {
                        <div class="bg-bg-glass border border-border-glass rounded-xl overflow-hidden">
                          <!-- File path header -->
                          <div class="flex items-center justify-between px-3 py-2 bg-bg-primary/50 border-b border-border-glass">
                            <div class="flex items-center gap-2 min-w-0">
                              <svg class="w-3.5 h-3.5 text-text-muted shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
                              </svg>
                              <span class="text-[11px] font-mono text-text-secondary truncate">{{ thread.path }}</span>
                              @if (thread.line) {
                                <span class="text-[10px] text-text-muted shrink-0">:{{ thread.line }}</span>
                              }
                            </div>
                            <button
                              (click)="copyFileName(thread.path)"
                              class="p-1 rounded text-text-muted hover:text-accent transition-colors cursor-pointer shrink-0"
                              [title]="copiedFileName() === thread.path ? 'Copied!' : 'Copy filename'">
                              @if (copiedFileName() === thread.path) {
                                <svg class="w-3.5 h-3.5 text-success" fill="currentColor" viewBox="0 0 20 20">
                                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                                </svg>
                              } @else {
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                              }
                            </button>
                          </div>
                          <!-- Diff hunk -->
                          @if (thread.diffHunk) {
                            <pre class="px-3 py-2 text-[10px] font-mono text-text-muted bg-bg-primary/30 border-b border-border-glass overflow-x-auto whitespace-pre leading-relaxed max-h-28 overflow-y-auto">{{ thread.diffHunk }}</pre>
                          }
                          <!-- Comments in thread -->
                          <div class="divide-y divide-border-glass">
                            @for (comment of thread.comments; track comment.id) {
                              <div class="px-3 py-3">
                                <div class="flex items-center gap-2 mb-1.5">
                                  <img [src]="comment.user.avatar_url" [alt]="comment.user.login"
                                    class="w-5 h-5 rounded-full shrink-0" />
                                  <span class="text-xs font-semibold text-text-primary">{{ comment.user.login }}</span>
                                  <span class="text-[10px] text-text-muted ml-auto">{{ comment.created_at | date:'MMM d, HH:mm' }}</span>
                                </div>
                                <div class="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap pl-7">{{ comment.body }}</div>
                              </div>
                            }
                          </div>
                          <!-- Reply to thread -->
                          @if (replyingTo() === thread.rootId) {
                            <div class="p-3 border-t border-border-glass bg-bg-primary/20">
                              <textarea
                                [(ngModel)]="replyText"
                                placeholder="Write a reply…"
                                rows="3"
                                class="w-full text-xs bg-bg-primary border border-border-glass rounded-lg px-3 py-2 text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent transition-colors"></textarea>
                              <div class="flex justify-end gap-2 mt-2">
                                <button
                                  (click)="replyingTo.set(null)"
                                  class="px-3 py-1 text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer">
                                  Cancel
                                </button>
                                <button
                                  (click)="submitReply(thread.rootId, thread.path)"
                                  [disabled]="isSubmitting()"
                                  class="px-3 py-1 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                                  {{ isSubmitting() ? 'Sending…' : 'Reply' }}
                                </button>
                              </div>
                            </div>
                          } @else {
                            <div class="px-3 py-2 border-t border-border-glass">
                              <button
                                (click)="replyingTo.set(thread.rootId)"
                                class="text-[11px] text-text-muted hover:text-accent transition-colors cursor-pointer">
                                ↩ Reply
                              </button>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }

                <!-- General PR comments -->
                @if (prComments().length > 0) {
                  <div>
                    <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wider mb-3">
                      Discussion ({{ prComments().length }})
                    </p>
                    <div class="space-y-2">
                      @for (comment of prComments(); track comment.id) {
                        <div class="bg-bg-glass border border-border-glass rounded-xl px-4 py-3">
                          <div class="flex items-center gap-2 mb-1.5">
                            <img [src]="comment.user.avatar_url" [alt]="comment.user.login"
                              class="w-5 h-5 rounded-full shrink-0" />
                            <span class="text-xs font-semibold text-text-primary">{{ comment.user.login }}</span>
                            <span class="text-[10px] text-text-muted ml-auto">{{ comment.created_at | date:'MMM d, HH:mm' }}</span>
                          </div>
                          <div class="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap pl-7">{{ comment.body }}</div>
                        </div>
                      }
                    </div>
                  </div>
                }

                @if (reviewThreads().length === 0 && prComments().length === 0) {
                  <div class="text-center py-16">
                    <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-glass border border-border-glass mb-3">
                      <svg class="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <p class="text-sm text-text-muted">No conversations yet</p>
                  </div>
                }
              </div>

              <!-- New general comment box -->
              <div class="shrink-0 border-t border-border-glass p-4 bg-bg-primary/30">
                @if (!showCommentBox) {
                  <div class="flex justify-end">
                    <button
                      (click)="showCommentBox = true"
                      class="px-4 py-1.5 text-xs font-medium border border-border-glass text-text-secondary rounded-lg hover:bg-bg-secondary transition-all cursor-pointer">
                      Add a comment
                    </button>
                  </div>
                } @else {
                  <textarea
                    [(ngModel)]="newCommentText"
                    placeholder="Leave a comment…"
                    rows="3"
                    class="w-full text-xs bg-bg-primary border border-border-glass rounded-lg px-3 py-2 text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent transition-colors mb-2"></textarea>
                  <div class="flex justify-end gap-2">
                    <button
                      (click)="showCommentBox = false; newCommentText = ''"
                      class="px-4 py-1.5 text-xs font-medium border border-border-glass text-text-secondary rounded-lg hover:bg-bg-secondary transition-all cursor-pointer">
                      Cancel
                    </button>
                    <button
                      (click)="submitComment()"
                      [disabled]="isSubmitting() || !newCommentText.trim()"
                      class="px-4 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                      {{ isSubmitting() ? 'Sending…' : 'Comment' }}
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        } @else {

        @if (pr().isLoading) {
          <!-- Loading state -->
          <div class="p-6 space-y-4">
            @for (i of [1, 2]; track i) {
              <div class="bg-bg-glass border border-border-glass rounded-xl p-4 animate-pulse-slow">
                <div class="h-4 bg-bg-card rounded w-1/3 mb-3"></div>
                <div class="h-3 bg-bg-card rounded w-2/3 mb-2"></div>
                <div class="h-3 bg-bg-card rounded w-1/2"></div>
              </div>
            }
          </div>
        } @else if (pr().ciStatus === 'success') {
          <!-- All green -->
          <div class="p-6">
            <div class="text-center py-12">
              <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success-bg border border-success-border mb-4">
                <svg class="w-8 h-8 text-success" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clip-rule="evenodd" />
                </svg>
              </div>
              <h3 class="text-lg font-semibold text-success mb-1">All checks passed</h3>
              <p class="text-sm text-text-muted">{{ pr().checkRuns.length }} check{{ pr().checkRuns.length !== 1 ? 's' : '' }} completed successfully.</p>
            </div>

            <!-- List all check runs -->
            <div class="space-y-2 mt-4">
              @for (check of pr().checkRuns; track check.id) {
                <div class="flex items-center gap-3 px-4 py-2.5 bg-bg-glass border border-border-glass rounded-lg">
                  <svg class="w-4 h-4 text-success shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clip-rule="evenodd" />
                  </svg>
                  <span class="text-sm text-text-primary">{{ check.name }}</span>
                </div>
              }
            </div>
          </div>

        } @else if (pr().ciStatus === 'pending') {
          <!-- Running -->
          <div class="p-6 text-center py-12">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-pending-bg border border-pending-border mb-4">
              <svg class="w-8 h-8 text-pending animate-spin-slow" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-pending mb-1">Checks running</h3>
            <p class="text-sm text-text-muted">Auto-refreshing every 15 seconds…</p>

            <div class="space-y-2 mt-6 text-left">
              @for (check of pr().checkRuns; track check.id) {
                <div class="flex items-center gap-3 px-4 py-2.5 bg-bg-glass border border-border-glass rounded-lg">
                  @if (check.status === 'in_progress' || check.status === 'queued') {
                    <svg class="w-4 h-4 text-pending animate-spin-slow shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  } @else if (check.conclusion === 'success') {
                    <svg class="w-4 h-4 text-success shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  } @else if (check.conclusion === 'failure') {
                    <svg class="w-4 h-4 text-danger shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  } @else {
                    <span class="w-4 h-4 rounded-full bg-text-muted/30 shrink-0"></span>
                  }
                  <span class="text-sm text-text-primary">{{ check.name }}</span>
                  <span class="text-xs text-text-muted ml-auto capitalize">{{ check.status }}</span>
                </div>
              }
            </div>
          </div>

        } @else if (pr().ciStatus === 'failure') {
          <!-- FAILURE — detailed breakdown -->
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-base font-semibold text-danger flex items-center gap-2">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clip-rule="evenodd" />
                </svg>
                {{ pr().failedJobs.length }} failed job{{ pr().failedJobs.length !== 1 ? 's' : '' }}
              </h3>
              <button
                (click)="rerunAllFailed.emit()"
                class="px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-amber-500 to-orange-600 text-white
                       rounded-lg hover:from-amber-600 hover:to-orange-700 active:scale-95
                       transition-all shadow-lg shadow-amber-500/20 cursor-pointer flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Rerun All Failed
              </button>
            </div>

            <!-- Failed jobs list -->
            <div class="space-y-4">
              @for (item of pr().failedJobs; track item.job.id) {
                <div class="bg-bg-glass border border-danger-border/30 rounded-xl overflow-hidden animate-slide-up">
                  <!-- Job header -->
                  <div class="flex items-center justify-between px-4 py-3 bg-danger-bg/30 border-b border-danger-border/20">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <svg class="w-4 h-4 text-danger shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clip-rule="evenodd" />
                      </svg>
                      <div class="min-w-0">
                        <p class="text-sm font-semibold text-text-primary truncate">{{ item.job.name }}</p>
                        <p class="text-[11px] text-text-muted">Workflow: {{ item.runName }}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <a [href]="item.job.html_url" target="_blank" rel="noopener noreferrer"
                        class="text-[11px] text-text-muted hover:text-accent transition-colors">
                        Logs ↗
                      </a>
                      <button
                        (click)="rerunJob.emit({ runId: item.runId, repoFullName: item.repoFullName })"
                        class="px-2 py-1 text-[11px] font-medium text-warning bg-warning-bg border border-warning-border
                               rounded-md hover:bg-warning/10 transition-all cursor-pointer active:scale-95">
                        ↻ Rerun
                      </button>
                    </div>
                  </div>

                  <!-- Log accessibility warning -->
                  @if (!item.logAccessible) {
                    <div class="px-4 py-2 bg-warning-bg/10 border-b border-warning-border/20 flex items-center gap-2">
                      <svg class="w-3.5 h-3.5 text-warning shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                      </svg>
                      <span class="text-[11px] text-warning font-medium">Log is not accessible</span>
                    </div>
                  }

                  <!-- Parsed test failures (priority display) -->
                  @if (item.testFailures.length > 0) {
                    <div class="p-4 space-y-3">
                      <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wider">
                        Test Failures ({{ item.testFailures.length }})
                      </p>

                      <!-- Group by suite:target -->
                      @for (group of groupBySuite(item.testFailures); track group.key) {
                        <div class="bg-bg-primary rounded-lg border border-border-glass overflow-hidden">
                          <!-- Suite header -->
                          <div class="flex items-center justify-between px-3 py-2 bg-danger-bg/20 border-b border-border-glass">
                            <div class="flex items-center gap-2 overflow-hidden">
                              <svg class="w-3.5 h-3.5 text-danger shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd"
                                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                  clip-rule="evenodd" />
                              </svg>
                              <span class="text-xs font-bold text-text-primary font-mono truncate">{{ group.key }}</span>
                              <button
                                (click)="copyCommand(group)"
                                class="p-1 text-text-muted hover:text-accent transition-colors cursor-pointer group/copy"
                                title="Copy nx command">
                                <svg class="w-3 h-3 group-active/copy:scale-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                              </button>
                            </div>
                            <span class="text-[10px] font-semibold text-danger bg-danger-bg px-2 py-0.5 rounded-full shrink-0">
                              {{ group.failures.length }} failing
                            </span>
                          </div>

                          <!-- Individual failures -->
                          <div class="divide-y divide-border-glass">
                            @for (failure of group.failures; track $index) {
                              <div class="p-3">
                                <!-- Test path (indented like Mocha) -->
                                <div class="space-y-0.5 mb-2">
                                  @for (part of failure.testPath; track $index; let i = $index; let last = $last) {
                                    <div class="flex items-start gap-1.5"
                                      [style.padding-left.px]="i * 12">
                                      @if (last) {
                                        <span class="text-danger text-[11px] shrink-0 mt-px">✕</span>
                                        <span class="text-xs text-text-primary font-medium">{{ part }}</span>
                                      } @else {
                                        <span class="text-text-muted text-[11px] shrink-0 mt-px">›</span>
                                        <span class="text-xs text-text-secondary">{{ part }}</span>
                                      }
                                    </div>
                                  }
                                </div>

                                <!-- Error message -->
                                @if (failure.errorMessage) {
                                  <div class="ml-3 mt-2 bg-danger-bg/30 border-l-2 border-danger/50 rounded-r-md px-3 py-2">
                                    <pre class="text-[11px] text-danger font-mono leading-relaxed whitespace-pre-wrap break-words">{{ failure.errorMessage }}</pre>
                                  </div>
                                }

                                <!-- Diff -->
                                @if (failure.diff) {
                                  <div class="ml-3 mt-2 bg-bg-primary rounded-md border border-border-glass overflow-hidden">
                                    <div class="px-3 py-1.5 bg-bg-glass border-b border-border-glass">
                                      <span class="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Expected vs Actual</span>
                                    </div>
                                    <pre class="px-3 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words"><!--
                                    -->@for (line of failure.diff!.split('\n'); track $index) {<!--
                                      -->@if (line.startsWith('+')) {<span class="text-success">{{ line }}</span>
} @else if (line.startsWith('-')) {<span class="text-danger">{{ line }}</span>
} @else {<span class="text-text-muted">{{ line }}</span>
}<!--
                                    -->}<!--
                                  --></pre>
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        </div>
                      }
                    </div>

                  <!-- Fallback: annotations -->
                  } @else if (item.annotations.length > 0) {
                    <div class="p-4 space-y-3">
                      <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wider">Error Details</p>
                      @for (annotation of item.annotations; track $index) {
                        <div class="bg-danger-bg/40 border border-danger-border/30 rounded-lg p-3">
                          @if (annotation.title) {
                            <p class="text-xs font-semibold text-danger mb-1.5">{{ annotation.title }}</p>
                          }
                          <pre class="text-xs text-text-secondary font-mono leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-h-64 overflow-y-auto">{{ annotation.message }}</pre>
                          @if (annotation.path) {
                            <div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-border-glass text-[11px] text-text-muted">
                              <svg class="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd"
                                  d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                                  clip-rule="evenodd" />
                              </svg>
                              <span class="font-mono">{{ annotation.path }}:{{ annotation.start_line }}{{ annotation.end_line !== annotation.start_line ? '-' + annotation.end_line : '' }}</span>
                            </div>
                          }
                        </div>
                      }
                    </div>

                  <!-- No data at all -->
                  } @else {
                    <div class="p-4">
                      <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wider mb-2">Error Details</p>
                      <div class="bg-bg-primary border border-border-glass rounded-lg p-3">
                        <p class="text-xs text-text-muted mb-2">
                          No test failures or annotations were found. Check the
                          <a [href]="item.job.html_url" target="_blank" rel="noopener noreferrer"
                            class="text-accent hover:underline">full job logs on GitHub</a>
                          for details.
                        </p>
                        @if (getFailedSteps(item).length > 0) {
                          <p class="text-xs text-text-secondary">
                            The job failed at step <span class="font-semibold text-danger">"{{ getFailedSteps(item)[0].name }}"</span>
                            (step #{{ getFailedSteps(item)[0].number }}).
                          </p>
                        }
                      </div>
                    </div>
                  }

                  <!-- Rerun command -->
                  <div class="px-4 py-2.5 bg-bg-primary/50 border-t border-border-glass">
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] text-text-muted shrink-0">CLI:</span>
                      <code class="text-[11px] font-mono text-accent select-all truncate">
                        gh run rerun {{ item.runId }} --failed
                      </code>
                    </div>
                  </div>
                </div>
              }
            </div>

            <!-- Also show passing checks for context -->
            @if (passingChecks().length > 0) {
              <div class="mt-6">
                <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wider mb-2">
                  Passing Checks ({{ passingChecks().length }})
                </p>
                <div class="space-y-1.5">
                  @for (check of passingChecks(); track check.id) {
                    <div class="flex items-center gap-2 px-3 py-2 bg-bg-glass border border-border-glass rounded-lg">
                      <svg class="w-3.5 h-3.5 text-success shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                      </svg>
                      <span class="text-xs text-text-secondary">{{ check.name }}</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>

        } @else {
          <!-- Unknown / no checks -->
          <div class="p-6 text-center py-12">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-warning-bg border border-warning-border mb-4">
              <svg class="w-8 h-8 text-warning" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clip-rule="evenodd" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-text-primary mb-1">No checks found</h3>
            <p class="text-sm text-text-muted">This repository may not use GitHub Actions, or checks haven't been registered yet.</p>
          </div>
        }

        } <!-- end @else (ci tab) -->
      </div>
    </div>
  `,
})
export class PrDetailComponent {
  private readonly api = inject(GitHubApiService);

  readonly pr = input.required<PullRequestWithStatus>();

  readonly reload = output<void>();
  readonly merge = output<void>();
  readonly rerunAllFailed = output<void>();
  readonly copyLink = output<string>();
  readonly rerunJob = output<{ runId: number; repoFullName: string }>();
  readonly prDetailsUpdated = output<{ title: string; body: string }>();

  readonly copied = signal(false);
  readonly activeTab = signal<'ci' | 'conversations' | 'details'>('ci');

  // Conversations state
  readonly prComments = signal<any[]>([]);
  readonly reviewComments = signal<any[]>([]);
  readonly isLoadingConversations = signal(false);
  readonly replyingTo = signal<number | null>(null);
  readonly copiedFileName = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  replyText = '';
  newCommentText = '';
  showCommentBox = false;

  private conversationsLoaded = false;

  // Details tab state
  readonly isSavingDetails = signal(false);
  readonly detailsSaveSuccess = signal(false);
  editTitle = '';
  editBody = '';

  readonly totalComments = computed(() =>
    this.prComments().length + this.reviewComments().length,
  );

  readonly reviewThreads = computed((): ReviewThread[] => {
    const all = this.reviewComments();
    const roots = all.filter(c => !c.in_reply_to_id);
    return roots.map(root => ({
      rootId: root.id,
      path: root.path,
      line: root.line ?? root.original_line ?? null,
      diffHunk: root.diff_hunk ?? null,
      comments: all.filter(c => c.id === root.id || c.in_reply_to_id === root.id),
    }));
  });

  readonly passingChecks = computed(() =>
    this.pr().checkRuns.filter(c =>
      c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral',
    ),
  );

  constructor() {
    // Reset conversations and details when PR changes
    effect(() => {
      const pr = this.pr();
      this.conversationsLoaded = false;
      this.prComments.set([]);
      this.reviewComments.set([]);
      this.replyingTo.set(null);
      this.replyText = '';
      this.newCommentText = '';
      this.editTitle = pr.pr.title;
      this.editBody = pr.pr.body ?? '';
      this.detailsSaveSuccess.set(false);
    });
  }

  switchToConversations(): void {
    this.activeTab.set('conversations');
    if (!this.conversationsLoaded) {
      this.loadConversations();
    }
  }

  async loadConversations(): Promise<void> {
    const { base, number } = this.pr().pr;
    const owner = base.repo.owner.login;
    const repo = base.repo.name;
    this.isLoadingConversations.set(true);
    try {
      const [comments, reviewComments] = await Promise.all([
        firstValueFrom(this.api.getPrComments(owner, repo, number)),
        firstValueFrom(this.api.getPrReviewComments(owner, repo, number)),
      ]);
      this.prComments.set(comments);
      this.reviewComments.set(reviewComments);
      this.conversationsLoaded = true;
    } finally {
      this.isLoadingConversations.set(false);
    }
  }

  async submitReply(threadRootId: number, _path: string): Promise<void> {
    const body = this.replyText.trim();
    if (!body) return;
    const { base, number } = this.pr().pr;
    const owner = base.repo.owner.login;
    const repo = base.repo.name;
    this.isSubmitting.set(true);
    try {
      const newComment = await firstValueFrom(
        this.api.replyToReviewComment(owner, repo, number, threadRootId, body),
      );
      this.reviewComments.update(list => [...list, newComment]);
      this.replyText = '';
      this.replyingTo.set(null);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async submitComment(): Promise<void> {
    const body = this.newCommentText.trim();
    if (!body) return;
    const { base, number } = this.pr().pr;
    const owner = base.repo.owner.login;
    const repo = base.repo.name;
    this.isSubmitting.set(true);
    try {
      const newComment = await firstValueFrom(
        this.api.createPrComment(owner, repo, number, body),
      );
      this.prComments.update(list => [...list, newComment]);
      this.newCommentText = '';
      this.showCommentBox = false;
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async saveDetails(): Promise<void> {
    const title = this.editTitle.trim();
    if (!title) return;
    this.isSavingDetails.set(true);
    try {
      this.prDetailsUpdated.emit({ title, body: this.editBody });
      this.detailsSaveSuccess.set(true);
      setTimeout(() => this.detailsSaveSuccess.set(false), 3000);
    } finally {
      this.isSavingDetails.set(false);
    }
  }

  copyFileName(path: string): void {
    navigator.clipboard.writeText(path).then(() => {
      this.copiedFileName.set(path);
      setTimeout(() => this.copiedFileName.set(null), 2000);
    });
  }

  getFailedSteps(item: WorkflowJobWithErrors) {
    return item.job.steps?.filter(s => s.conclusion === 'failure') ?? [];
  }

  copyPrLink(): void {
    navigator.clipboard.writeText(this.pr().pr.html_url).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  groupBySuite(failures: ParsedTestFailure[]): { key: string; failures: ParsedTestFailure[]; suite: string }[] {
    const map = new Map<string, ParsedTestFailure[]>();
    for (const f of failures) {
      const key = `${f.suite}:${f.target}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      failures: items,
      suite: items[0].suite
    }));
  }

  copyCommand(group: { key: string; suite: string }): void {
    const originalTarget = group.key.split(':')[1];
    const target = (originalTarget === 'component-test' || originalTarget === 'e2e')
      ? 'open-cypress'
      : originalTarget;
    const fullCommand = `pnpm exec nx run ${group.suite}:${target}`;
    navigator.clipboard.writeText(fullCommand);
  }
}
