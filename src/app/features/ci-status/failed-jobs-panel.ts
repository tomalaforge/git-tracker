import { Component, input, output } from '@angular/core';
import { WorkflowJobWithErrors } from '../../models';
import { ErrorDetailComponent } from './error-detail';

@Component({
  selector: 'gt-failed-jobs-panel',
  standalone: true,
  imports: [ErrorDetailComponent],
  template: `
    <div class="space-y-3 animate-slide-up">
      @for (item of failedJobs(); track item.job.id) {
        <div class="bg-bg-glass border border-border-glass rounded-xl overflow-hidden">
          <!-- Job header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-border-glass">
            <div class="flex items-center gap-3 min-w-0">
              <svg class="w-4 h-4 text-danger shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clip-rule="evenodd" />
              </svg>
              <div class="min-w-0">
                <p class="text-sm font-medium text-text-primary truncate">{{ item.job.name }}</p>
                <p class="text-xs text-text-muted">{{ item.runName }}</p>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <a [href]="item.job.html_url" target="_blank" rel="noopener noreferrer"
                class="text-xs text-text-muted hover:text-accent transition-colors">
                View on GitHub ↗
              </a>
              <button
                (click)="rerunJob.emit({ runId: item.runId, repoFullName: item.repoFullName })"
                class="px-3 py-1.5 text-xs font-medium text-warning bg-warning-bg border border-warning-border
                       rounded-lg hover:bg-warning/10 transition-all cursor-pointer active:scale-95">
                ↻ Rerun
              </button>
            </div>
          </div>

          <!-- Failed steps -->
          @if (item.job.steps && item.job.steps.length > 0) {
            <div class="px-4 py-2 border-b border-border-glass">
              <p class="text-xs text-text-muted mb-1.5 font-medium uppercase tracking-wider">Failed Steps</p>
              <div class="space-y-1">
                @for (step of getFailedSteps(item.job.steps); track step.number) {
                  <div class="flex items-center gap-2 text-xs">
                    <span class="text-danger">✕</span>
                    <span class="text-text-secondary">Step {{ step.number }}:</span>
                    <span class="text-text-primary font-mono">{{ step.name }}</span>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Annotations / Errors -->
          @if (item.annotations.length > 0) {
            <div class="p-4">
              <p class="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Errors</p>
              <div class="space-y-2">
                @for (annotation of item.annotations; track $index) {
                  <gt-error-detail [annotation]="annotation" />
                }
              </div>
            </div>
          } @else {
            <div class="px-4 py-3">
              <p class="text-xs text-text-muted italic">No annotations available. Check logs on GitHub for details.</p>
            </div>
          }

          <!-- Rerun command -->
          <div class="px-4 py-3 bg-bg-primary/50 border-t border-border-glass">
            <p class="text-xs text-text-muted mb-1">Rerun command:</p>
            <code class="block text-xs font-mono text-accent bg-bg-primary px-3 py-2 rounded-lg border border-border-glass select-all">
              gh run rerun {{ item.runId }} --failed
            </code>
          </div>
        </div>
      }
    </div>
  `,
})
export class FailedJobsPanelComponent {
  readonly failedJobs = input.required<WorkflowJobWithErrors[]>();
  readonly rerunJob = output<{ runId: number; repoFullName: string }>();

  getFailedSteps(steps: WorkflowJobWithErrors['job']['steps']): typeof steps {
    return steps.filter(s => s.conclusion === 'failure');
  }
}
