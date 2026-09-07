import { Component, input, signal, inject, effect } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { GitHubApiService } from '../../core';
import { PullRequest } from '../../models';
import { CoverageService, CoverageReport } from './coverage.service';

type CoverageState = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';

/** Lifecycle of the "ask CodeRabbit for test ideas" action. */
type AskState = 'idle' | 'posting' | 'waiting' | 'answered' | 'timeout' | 'error';

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
                  (click)="askCoderabbit()"
                  [disabled]="askState() === 'posting' || askState() === 'waiting'"
                  class="px-3 py-1.5 text-xs font-semibold bg-bg-glass border border-border-glass rounded-lg
                         text-text-secondary hover:text-text-primary hover:border-border-hover transition-all
                         cursor-pointer active:scale-95 flex items-center gap-1.5
                         disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Ask CodeRabbit which meaningful tests to add"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z"
                    />
                  </svg>
                  Ask CodeRabbit for tests
                </button>
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

            <!-- CodeRabbit test suggestions -->
            @if (askState() !== 'idle') {
              <div class="mt-4 bg-bg-glass border border-border-glass rounded-xl p-4">
                <div class="flex items-center gap-2 mb-2">
                  <svg
                    class="w-4 h-4 text-accent shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z"
                    />
                  </svg>
                  <p class="text-xs font-semibold text-text-primary flex-1">
                    CodeRabbit — meaningful tests to add
                  </p>
                  @if (askState() === 'answered' || askState() === 'timeout' || askState() === 'error') {
                    <button
                      (click)="askCoderabbit()"
                      class="text-[10px] font-semibold text-text-muted hover:text-text-primary
                             transition-colors cursor-pointer"
                      title="Post the question again"
                    >
                      Ask again
                    </button>
                  }
                </div>

                @switch (askState()) {
                  @case ('posting') {
                    <p class="text-xs text-text-muted flex items-center gap-2">
                      <span
                        class="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin"
                      ></span>
                      Posting your question on the pull request…
                    </p>
                  }
                  @case ('waiting') {
                    <p class="text-xs text-text-muted flex items-center gap-2">
                      <span
                        class="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin"
                      ></span>
                      Waiting for CodeRabbit to answer… this usually takes a few minutes.
                    </p>
                  }
                  @case ('answered') {
                    <div
                      class="coderabbit-md text-xs text-text-secondary max-h-72 overflow-y-auto pr-1"
                      [innerHTML]="coderabbitResponse()"
                    ></div>
                  }
                  @case ('timeout') {
                    <div class="space-y-2">
                      <p class="text-xs text-text-muted">
                        CodeRabbit hasn't answered yet. The question was posted — you can keep
                        waiting or check the PR conversation on GitHub.
                      </p>
                      <button
                        (click)="repollCoderabbit()"
                        class="px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded-lg
                               hover:bg-accent/90 transition-all cursor-pointer active:scale-95
                               flex items-center gap-1.5"
                      >
                        <svg
                          class="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        Poll again for 1 min
                      </button>
                    </div>
                  }
                  @case ('error') {
                    <p class="text-xs text-danger">{{ askError() }}</p>
                  }
                }
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
  styles: [
    `
      .coderabbit-md ::ng-deep p {
        margin: 0 0 0.5rem;
      }
      .coderabbit-md ::ng-deep p:last-child {
        margin-bottom: 0;
      }
      .coderabbit-md ::ng-deep ul {
        list-style: disc;
        padding-left: 1.25rem;
        margin: 0 0 0.5rem;
      }
      .coderabbit-md ::ng-deep ol {
        list-style: decimal;
        padding-left: 1.25rem;
        margin: 0 0 0.5rem;
      }
      .coderabbit-md ::ng-deep li {
        margin: 0.15rem 0;
      }
      .coderabbit-md ::ng-deep code {
        font-family: ui-monospace, monospace;
        background: rgba(255, 255, 255, 0.08);
        padding: 0.1em 0.3em;
        border-radius: 4px;
      }
      .coderabbit-md ::ng-deep pre {
        background: rgba(0, 0, 0, 0.3);
        padding: 0.5rem;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0 0 0.5rem;
      }
      .coderabbit-md ::ng-deep pre code {
        background: none;
        padding: 0;
      }
      .coderabbit-md ::ng-deep a {
        color: var(--accent, #6366f1);
        text-decoration: underline;
      }
      .coderabbit-md ::ng-deep h1,
      .coderabbit-md ::ng-deep h2,
      .coderabbit-md ::ng-deep h3,
      .coderabbit-md ::ng-deep h4 {
        font-weight: 600;
        margin: 0.5rem 0 0.25rem;
        color: var(--text-primary, inherit);
      }
    `,
  ],
})
export class CoverageReportComponent {
  private readonly coverage = inject(CoverageService);
  private readonly api = inject(GitHubApiService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly pr = input.required<PullRequest>();
  /** The tab is active — only load when shown. */
  readonly active = input<boolean>(false);
  /**
   * Opaque token that changes when the coverage artifact may have changed (e.g.
   * CI re-ran for the same commit). When it changes, the report reloads.
   */
  readonly refreshKey = input<string>('');

  readonly state = signal<CoverageState>('idle');
  readonly report = signal<CoverageReport | null>(null);
  readonly safeHtml = signal<SafeHtml>('');
  readonly errorMessage = signal<string>('');

  readonly askState = signal<AskState>('idle');
  readonly askError = signal<string>('');
  readonly coderabbitResponse = signal<SafeHtml | null>(null);

  /** The exact question posted on the PR for CodeRabbit. */
  private readonly CODERABBIT_PROMPT = '@coderabbitai what meaningful tests should I add?';
  /** Bumped on each ask so a stale poll loop (PR switched, re-asked) bails out. */
  private askSeq = 0;
  /** Epoch ms of our posted question — replies older than this are ignored. */
  private askSince: number | null = null;

  private loadedKey: string | null = null;
  private askedPrId: number | null = null;

  constructor() {
    effect(() => {
      const pr = this.pr();
      const isActive = this.active();
      const key = `${pr.id}:${pr.head.sha}:${this.refreshKey()}`;

      // A different PR is now in view — drop any previous CodeRabbit Q&A and
      // invalidate an in-flight poll loop so it can't write a stale answer here.
      if (this.askedPrId !== null && this.askedPrId !== pr.id) {
        this.resetAsk();
      }

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

  /**
   * Post "@coderabbitai what meaningful tests should I add?" on the PR, then
   * poll the conversation until CodeRabbit replies and render the answer here.
   * CodeRabbit typically takes a couple of minutes, so we hold off for 2 minutes
   * before the first check, then poll every 10s until the 5-minute mark.
   */
  async askCoderabbit(): Promise<void> {
    const pr = this.pr();
    const [owner, repo] = pr.base.repo.full_name.split('/');
    const askId = ++this.askSeq;

    this.askedPrId = pr.id;
    this.askError.set('');
    this.coderabbitResponse.set(null);
    this.askState.set('posting');

    try {
      const posted = (await firstValueFrom(
        this.api.createPrComment(owner, repo, pr.number, this.CODERABBIT_PROMPT),
      )) as { created_at?: string };
      if (askId !== this.askSeq) return;

      // Only accept replies created after our question went up.
      this.askSince = posted?.created_at ? new Date(posted.created_at).getTime() : Date.now();
      this.askState.set('waiting');

      await this.pollAndRender(owner, repo, pr.number, askId, {
        initialDelayMs: 2 * 60_000,
        windowMs: 3 * 60_000,
      });
    } catch (err: any) {
      if (askId !== this.askSeq) return;
      this.askError.set(err?.error?.message || err?.message || 'Failed to ask CodeRabbit.');
      this.askState.set('error');
    }
  }

  /**
   * Poll the PR for another minute (every 10s) for a CodeRabbit reply to the
   * question we already posted. Used when the initial window timed out.
   */
  async repollCoderabbit(): Promise<void> {
    if (this.askSince === null) return;
    const pr = this.pr();
    const [owner, repo] = pr.base.repo.full_name.split('/');
    const askId = ++this.askSeq;

    this.askError.set('');
    this.askState.set('waiting');

    try {
      await this.pollAndRender(owner, repo, pr.number, askId, {
        initialDelayMs: 0,
        windowMs: 60_000,
      });
    } catch (err: any) {
      if (askId !== this.askSeq) return;
      this.askError.set(err?.error?.message || err?.message || 'Failed to reach CodeRabbit.');
      this.askState.set('error');
    }
  }

  private async pollAndRender(
    owner: string,
    repo: string,
    prNumber: number,
    askId: number,
    opts: { initialDelayMs: number; windowMs: number },
  ): Promise<void> {
    const reply = await this.pollForCoderabbitReply(owner, repo, prNumber, askId, opts);
    if (askId !== this.askSeq) return;

    if (!reply) {
      this.askState.set('timeout');
      return;
    }

    const html: string = reply.body_html || reply.bodyHtml || '';
    this.coderabbitResponse.set(
      this.sanitizer.bypassSecurityTrustHtml(html || this.escapeToHtml(reply.body || '')),
    );
    this.askState.set('answered');
  }

  private async pollForCoderabbitReply(
    owner: string,
    repo: string,
    prNumber: number,
    askId: number,
    opts: { initialDelayMs: number; windowMs: number },
  ): Promise<any | null> {
    const intervalMs = 10_000;

    if (opts.initialDelayMs > 0) {
      await this.delay(opts.initialDelayMs);
      if (askId !== this.askSeq) return null;
    }

    const attempts = Math.max(1, Math.round(opts.windowMs / intervalMs));
    for (let attempt = 0; attempt < attempts; attempt++) {
      const comments = (await firstValueFrom(
        this.api.getPrComments(owner, repo, prNumber),
      )) as any[];
      if (askId !== this.askSeq) return null;

      const reply = comments
        .filter((c) => this.isCoderabbit(c.user?.login) && this.commentTime(c) > (this.askSince ?? 0))
        .sort((a, b) => this.commentTime(a) - this.commentTime(b))[0];
      if (reply) return reply;

      await this.delay(intervalMs);
      if (askId !== this.askSeq) return null;
    }
    return null;
  }

  private isCoderabbit(login?: string): boolean {
    return !!login && login.toLowerCase().includes('coderabbitai');
  }

  private commentTime(comment: any): number {
    return new Date(comment.created_at ?? comment.updated_at ?? 0).getTime();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Render plain-text comment bodies safely when GitHub gives us no HTML. */
  private escapeToHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${div.innerHTML}</pre>`;
  }

  private resetAsk(): void {
    this.askSeq++;
    this.askState.set('idle');
    this.askError.set('');
    this.coderabbitResponse.set(null);
    this.askedPrId = null;
    this.askSince = null;
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
