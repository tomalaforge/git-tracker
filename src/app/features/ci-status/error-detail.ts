import { Component, input } from '@angular/core';
import { CheckAnnotation } from '../../models';

@Component({
  selector: 'gt-error-detail',
  standalone: true,
  template: `
    <div class="bg-danger-bg/50 border border-danger-border/50 rounded-lg p-3 animate-fade-in">
      @if (annotation().title) {
        <p class="text-xs font-semibold text-danger mb-1">{{ annotation().title }}</p>
      }
      <p class="text-xs text-text-secondary font-mono leading-relaxed whitespace-pre-wrap break-words">{{ annotation().message }}</p>
      @if (annotation().path) {
        <div class="flex items-center gap-1.5 mt-2 text-xs text-text-muted">
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
              clip-rule="evenodd" />
          </svg>
          <span class="font-mono">{{ annotation().path }}:{{ annotation().start_line }}</span>
        </div>
      }
    </div>
  `,
})
export class ErrorDetailComponent {
  readonly annotation = input.required<CheckAnnotation>();
}
