import { Component, input, signal, inject, effect } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PullRequest } from '../../models';
import { CoverageService, CoverageReport } from './coverage.service';

type CoverageState = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';

@Component({
  selector: 'gt-coverage-report',
  standalone: true,
  imports: [],
  template: `
    <div class="h-full flex flex-col">
      @switch (state()) {
        @case ('loading') {
          <div class="p-6 space-y-4">
            <div class="bg-bg-glass border border-border-glass rounded-xl p-4 animate-pulse-slow">
              <div class="h-4 bg-bg-card rounded w-1/3 mb-3"></div>
              <div class="h-3 bg-bg-card rounded w-2/3 mb-2"></div>
              <div class="h-3 bg-bg-card rounded w-1/2"></div>
            </div>
            <p class="text-xs text-text-muted text-center">Downloading coverage report…</p>
          </div>
        }
        @case ('ready') {
          <!-- Summary bar -->
          <div class="shrink-0 px-6 py-4 border-b border-border-glass bg-bg-card/50">
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-4 min-w-0">
                @if (report()?.totalCoverage != null) {
                  <div class="flex items-center gap-3">
                    <div class="relative w-14 h-14 shrink-0">
                      <svg class="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                        <circle
                          cx="18"
                          cy="18"
                          r="16"
                          fill="none"
                          class="stroke-bg-glass"
                          stroke-width="3"
                        />
                        <circle
                          cx="18"
                          cy="18"
                          r="16"
                          fill="none"
                          stroke-width="3"
                          stroke-linecap="round"
                          [attr.stroke]="coverageColor(report()!.totalCoverage!)"
                          [attr.stroke-dasharray]="100.53"
                          [attr.stroke-dashoffset]="
                            100.53 - (100.53 * report()!.totalCoverage!) / 100
                          "
                        />
                      </svg>
                      <span
                        class="absolute inset-0 flex items-center justify-center text-xs font-bold text-text-primary"
                      >
                        {{ report()!.totalCoverage!.toFixed(0) }}%
                      </span>
                    </div>
                    <div>
                      <p class="text-sm font-semibold text-text-primary">Total coverage</p>
                      <p class="text-xs text-text-muted">
                        {{ missingFiles().length }} file(s) with missing lines
                      </p>
                    </div>
                  </div>
                } @else {
                  <div>
                    <p class="text-sm font-semibold text-text-primary">Coverage report</p>
                    <p class="text-xs text-text-muted">Rendered from the pipeline artifact</p>
                  </div>
                }
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button
                  (click)="downloadIndex()"
                  class="px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded-lg
                         hover:bg-accent/90 transition-all cursor-pointer active:scale-95 flex items-center gap-1.5"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Download index.html
                </button>
                <button
                  (click)="reload()"
                  class="p-1.5 rounded-lg bg-bg-glass border border-border-glass hover:border-border-hover
                         text-text-muted hover:text-text-primary transition-all cursor-pointer active:scale-95"
                  title="Reload report"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Missing lines highlight -->
            @if (missingFiles().length > 0) {
              <div class="mt-4 space-y-1.5">
                <p class="text-[10px] text-warning font-semibold uppercase tracking-wider">
                  Files with uncovered lines
                </p>
                <div class="space-y-1 max-h-40 overflow-y-auto pr-1">
                  @for (file of missingFiles(); track file.name) {
                    <div
                      class="flex items-center gap-3 px-3 py-1.5 bg-bg-glass border border-border-glass rounded-lg"
                    >
                      <span class="text-xs font-mono text-text-primary truncate flex-1 min-w-0">{{
                        file.name
                      }}</span>
                      @if (file.missing != null) {
                        <span
                          class="text-[10px] font-semibold text-danger bg-danger-bg px-2 py-0.5 rounded-full shrink-0"
                        >
                          {{ file.missing }} missing
                        </span>
                      }
                      @if (file.coverage != null) {
                        <div class="flex items-center gap-1.5 shrink-0 w-28">
                          <div class="flex-1 h-1.5 rounded-full bg-bg-card overflow-hidden">
                            <div
                              class="h-full rounded-full"
                              [style.width.%]="file.coverage"
                              [style.background-color]="coverageColor(file.coverage)"
                            ></div>
                          </div>
                          <span class="text-[10px] font-mono text-text-muted w-9 text-right"
                            >{{ file.coverage.toFixed(0) }}%</span
                          >
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          </div>

          <!-- Full rendered report -->
          <div class="flex-1 min-h-0 bg-white">
            <iframe
              [srcdoc]="safeHtml()"
              sandbox="allow-scripts"
              class="w-full h-full border-0"
              title="Coverage report"
            ></iframe>
          </div>
        }
        @case ('empty') {
          <div class="p-6 text-center py-16">
            <div
              class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-bg-glass border border-border-glass mb-4"
            >
              <svg
                class="w-8 h-8 text-text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-text-primary mb-1">No coverage report</h3>
            <p class="text-sm text-text-muted">
              No <span class="font-mono">coverage_html_report</span> artifact was found for this
              commit.
            </p>
          </div>
        }
        @case ('unavailable') {
          <div class="p-6 text-center py-16">
            <div
              class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-warning-bg border border-warning-border mb-4"
            >
              <svg class="w-8 h-8 text-warning" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-text-primary mb-1">Desktop app required</h3>
            <p class="text-sm text-text-muted">
              Downloading artifacts is only available in the GitTracker desktop app.
            </p>
          </div>
        }
        @case ('error') {
          <div class="p-6 text-center py-16">
            <div
              class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-danger-bg border border-danger-border mb-4"
            >
              <svg class="w-8 h-8 text-danger" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a1 1 0 011 1v4a1 1 0 11-2 0V6a1 1 0 011-1zm0 8a1 1 0 100 2 1 1 0 000-2z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-danger mb-1">Couldn't load coverage</h3>
            <p class="text-sm text-text-muted">{{ errorMessage() }}</p>
            <button
              (click)="reload()"
              class="mt-4 px-3 py-1.5 text-xs font-semibold bg-bg-glass border border-border-glass rounded-lg
                     text-text-secondary hover:text-text-primary transition-all cursor-pointer"
            >
              Try again
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class CoverageReportComponent {
  private readonly coverage = inject(CoverageService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly pr = input.required<PullRequest>();
  /** The tab is active — only load when shown. */
  readonly active = input<boolean>(false);

  readonly state = signal<CoverageState>('idle');
  readonly report = signal<CoverageReport | null>(null);
  readonly safeHtml = signal<SafeHtml>('');
  readonly errorMessage = signal<string>('');

  private loadedKey: string | null = null;

  constructor() {
    effect(() => {
      const pr = this.pr();
      const isActive = this.active();
      const key = `${pr.id}:${pr.head.sha}`;

      if (!isActive) return;
      if (this.loadedKey === key && this.state() !== 'idle') return;

      this.loadedKey = key;
      void this.load(pr);
    });
  }

  readonly missingFiles = () =>
    (this.report()?.files ?? []).filter(
      (f) => (f.missing != null && f.missing > 0) || (f.coverage != null && f.coverage < 100),
    );

  reload(): void {
    this.loadedKey = null;
    void this.load(this.pr());
  }

  private async load(pr: PullRequest): Promise<void> {
    if (!this.coverage.isAvailable()) {
      this.state.set('unavailable');
      return;
    }

    this.state.set('loading');
    this.report.set(null);
    try {
      const report = await this.coverage.loadReport(pr);
      if (!report) {
        this.state.set('empty');
        return;
      }
      this.report.set(report);
      this.safeHtml.set(this.sanitizer.bypassSecurityTrustHtml(report.html));
      this.state.set('ready');
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to load coverage report.');
      this.state.set('error');
    }
  }

  coverageColor(pct: number): string {
    if (pct >= 90) return '#22c55e';
    if (pct >= 75) return '#eab308';
    if (pct >= 50) return '#f97316';
    return '#ef4444';
  }

  downloadIndex(): void {
    const report = this.report();
    if (!report) return;
    const blob = new Blob([report.rawHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coverage-${this.pr().number}-index.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
