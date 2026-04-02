import { Component, input } from '@angular/core';
import { CIStatus } from '../../models';

@Component({
  selector: 'gt-ci-badge',
  standalone: true,
  template: `
    @switch (status()) {
      @case ('success') {
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                     bg-success-bg text-success border border-success-border">
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd" />
          </svg>
          Passing
        </span>
      }
      @case ('failure') {
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                     bg-danger-bg text-danger border border-danger-border">
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clip-rule="evenodd" />
          </svg>
          Failing
        </span>
      }
      @case ('pending') {
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                     bg-pending-bg text-pending border border-pending-border">
          <svg class="w-3.5 h-3.5 animate-spin-slow" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Running
        </span>
      }
      @default {
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                     bg-warning-bg text-warning border border-warning-border">
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clip-rule="evenodd" />
          </svg>
          Unknown
        </span>
      }
    }
  `,
})
export class CiBadgeComponent {
  readonly status = input.required<CIStatus>();
}
