import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PullRequestWithStatus } from '../../models';
import { CiBadgeComponent } from '../ci-status/ci-badge';

@Component({
  selector: 'gt-pr-sidebar-item',
  standalone: true,
  imports: [CiBadgeComponent, DatePipe],
  template: `
    <button
      (click)="select.emit()"
      class="relative w-full text-left px-4 py-3 border-b border-border-glass transition-all duration-150 cursor-pointer
             hover:bg-bg-card-hover group"
      [class.bg-bg-card]="isSelected()"
      [class.border-l-2]="isSelected()"
      [class.border-l-accent]="isSelected()">
      
      <!-- Unread indicator -->
      @if (prData().unseenDiscussions || prData().unseenApproval || prData().unseenCiFinish) {
        <div class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(var(--accent-rgb),0.6)]"></div>
      }

      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-0.5">
            <p class="text-[11px] text-text-muted font-mono truncate">
              {{ prData().pr.base.repo.full_name }}#{{ prData().pr.number }}
            </p>
            @if (prData().pr.draft) {
              <span class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-bg-glass text-text-muted border border-border-glass uppercase tracking-tight shrink-0">
                Draft
              </span>
            }
          </div>
          <p class="text-sm font-medium text-text-primary leading-snug line-clamp-2 mt-0.5"
            [class.text-accent]="isSelected()">
            {{ prData().pr.title }}
          </p>
          <div class="flex items-center gap-1.5 mt-1 flex-wrap">
            <span class="text-[11px] text-text-muted truncate">
              {{ prData().pr.head.ref }} · {{ prData().pr.updated_at | date:'MMM d, HH:mm' }}
              @if (prData().checkRuns.length > 0) {
                · {{ prData().checkRuns.length }} check{{ prData().checkRuns.length !== 1 ? 's' : '' }}
              }
            </span>
          </div>
        </div>

            <div class="flex items-center gap-1.5 pt-0.5">
              @if (prData().isLoading) {
                <svg class="w-3.5 h-3.5 animate-spin-slow text-text-muted" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              } @else {
                <!-- CI Status icon (mini) -->
                <div [title]="'CI Status: ' + prData().ciStatus" class="flex-shrink-0">
                  <gt-ci-badge [status]="prData().ciStatus" size="mini" />
                </div>

                <!-- Unresolved Discussions Icon -->
                @if (prData().discussionStatus !== 'NONE') {
                  <div 
                    [title]="prData().discussionStatus === 'NEW_CONTENT' ? 'New comments / Needs reply' : 'Unresolved Discussions'" 
                    class="flex-shrink-0"
                    [class.text-accent]="prData().discussionStatus === 'REPLIED'"
                    [class.text-danger]="prData().discussionStatus === 'NEW_CONTENT'"
                    [class.animate-pulse-slow]="prData().discussionStatus === 'NEW_CONTENT'"
                  >
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z" clip-rule="evenodd" />
                    </svg>
                  </div>
                }

                <!-- Review Status Icon -->
                @if (prData().reviewStatus === 'APPROVED') {
                  <div title="Approved" class="text-success flex-shrink-0">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                    </svg>
                  </div>
                } @else if (prData().reviewStatus === 'CHANGES_REQUESTED') {
                  <div title="Changes Requested" class="text-danger flex-shrink-0">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                    </svg>
                  </div>
                } @else if (prData().reviewStatus === 'PENDING') {
                  <div title="Pending Review" class="text-warning flex-shrink-0">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
                    </svg>
                  </div>
                } @else if (prData().reviewStatus === 'DISMISSED') {
                  <div title="Review Dismissed" class="text-text-muted flex-shrink-0">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                    </svg>
                  </div>
                }
              }
            </div>
      </div>
    </button>
  `,
  styles: `
    .line-clamp-2 {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `,
})
export class PrSidebarItemComponent {
  readonly prData = input.required<PullRequestWithStatus>();
  readonly isSelected = input<boolean>(false);
  readonly select = output<void>();
}
