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
      class="w-full text-left px-4 py-3 border-b border-border-glass transition-all duration-150 cursor-pointer
             hover:bg-bg-card-hover group"
      [class.bg-bg-card]="isSelected()"
      [class.border-l-2]="isSelected()"
      [class.border-l-accent]="isSelected()">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-[11px] text-text-muted font-mono truncate">
            {{ prData().pr.base.repo.full_name }}#{{ prData().pr.number }}
          </p>
          <p class="text-sm font-medium text-text-primary leading-snug line-clamp-2 mt-0.5"
            [class.text-accent]="isSelected()">
            {{ prData().pr.title }}
          </p>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-[11px] text-text-muted truncate">
              {{ prData().pr.head.ref }} · {{ prData().pr.updated_at | date:'MMM d, HH:mm' }}
            </span>
            @if (prData().reviewStatus === 'APPROVED') {
              <svg class="w-2.5 h-2.5 text-success shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            }
          </div>
        </div>
        <div class="shrink-0 pt-1">
          @if (prData().isLoading) {
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-bg-glass text-text-muted border border-border-glass">
              <svg class="w-3 h-3 animate-spin-slow mr-1" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </span>
          } @else {
            <gt-ci-badge [status]="prData().ciStatus" />
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
