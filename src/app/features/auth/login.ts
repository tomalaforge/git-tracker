import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'gt-login',
  standalone: true,
  template: `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <!-- Logo area -->
        <div class="text-center mb-10">
          <div
            class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 mb-4 shadow-lg shadow-indigo-500/20">
            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 class="text-3xl font-bold text-text-primary tracking-tight">GitTracker</h1>
          <p class="text-text-secondary mt-2 text-sm">Monitor your PRs and CI pipeline in real-time</p>
        </div>

        <!-- Card -->
        <div
          class="bg-bg-card backdrop-blur-xl border border-border-glass rounded-2xl p-8 shadow-2xl shadow-black/20 animate-slide-up">
          <h2 class="text-lg font-semibold text-text-primary mb-1">Connect to GitHub</h2>
          <p class="text-text-muted text-sm mb-6">
            Enter your Personal Access Token to get started.
          </p>

          <!-- Token input -->
          <div class="space-y-4">
            <div>
              <label for="pat-input" class="block text-sm font-medium text-text-secondary mb-2">
                Personal Access Token
              </label>
              <input
                id="pat-input"
                [type]="showToken() ? 'text' : 'password'"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                [value]="tokenValue()"
                (input)="onTokenInput($event)"
                (keydown.enter)="onSubmit()"
                class="w-full px-4 py-3 bg-bg-primary border border-border-glass rounded-xl text-text-primary placeholder-text-muted
                       focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
                       font-mono text-sm transition-all duration-200"
                [disabled]="auth.isValidating()" />
              <button
                (click)="showToken.set(!showToken())"
                class="mt-2 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
                {{ showToken() ? 'Hide' : 'Show' }} token
              </button>
            </div>

            @if (auth.error()) {
              <div
                class="flex items-center gap-2 px-4 py-3 bg-danger-bg border border-danger-border rounded-xl text-danger text-sm animate-fade-in">
                <svg class="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clip-rule="evenodd" />
                </svg>
                {{ auth.error() }}
              </div>
            }

            <button
              (click)="onSubmit()"
              [disabled]="auth.isValidating() || !tokenValue()"
              class="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl
                     hover:from-indigo-600 hover:to-purple-700 active:scale-[0.98]
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
                     transition-all duration-200 shadow-lg shadow-indigo-500/20 cursor-pointer
                     flex items-center justify-center gap-2">
              @if (auth.isValidating()) {
                <svg class="animate-spin-slow w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Connecting...
              } @else {
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Connect to GitHub
              }
            </button>
          </div>

          <!-- Help section -->
          <div class="mt-6 pt-6 border-t border-border-glass">
            <p class="text-xs text-text-muted leading-relaxed">
              Need a token?
              <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer"
                class="text-accent hover:text-accent-hover underline underline-offset-2">
                Create one here
              </a>
              with <code class="px-1.5 py-0.5 bg-bg-glass border border-border-glass rounded text-text-secondary font-mono">repo</code>
              and <code class="px-1.5 py-0.5 bg-bg-glass border border-border-glass rounded text-text-secondary font-mono">actions</code> scopes.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly tokenValue = signal('');
  readonly showToken = signal(false);

  onTokenInput(event: Event): void {
    this.tokenValue.set((event.target as HTMLInputElement).value);
  }

  async onSubmit(): Promise<void> {
    const token = this.tokenValue().trim();
    if (!token) return;

    const success = await this.auth.login(token);
    if (success) {
      this.router.navigate(['/dashboard']);
    }
  }
}
