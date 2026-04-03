import { Injectable, signal, computed, inject } from '@angular/core';
import { GitHubApiService } from '../../core';
import { GitHubUser } from '../../models';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';

const TOKEN_KEY = 'gt_github_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly githubApi = inject(GitHubApiService);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(this.loadToken());
  private readonly _user = signal<GitHubUser | null>(null);
  private readonly _isValidating = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isValidating = this._isValidating.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => !!this._token() && !!this._user());

  constructor() {
    // If we already have a stored token, validate it on startup
    if (this._token()) {
      this.validateToken();
    }
  }

  async login(token: string): Promise<boolean> {
    this._isValidating.set(true);
    this._error.set(null);
    this._token.set(token);

    try {
      const user = await firstValueFrom(this.githubApi.getAuthenticatedUser());
      this._user.set(user);
      this.saveToken(token);
      this._isValidating.set(false);
      return true;
    } catch (err: any) {
      this.logout();
      this._isValidating.set(false);
      this._error.set(err?.status === 401 ? 'Invalid token. Please check and try again.' : 'Connection failed. Please try again.');
      return false;
    }
  }

  logout(): void {
    this._token.set(null);
    this._user.set(null);
    this.clearToken();
    this.router.navigate(['/login']);
  }

  async validateToken(): Promise<void> {
    this._isValidating.set(true);
    try {
      // Timeout after 8 seconds to prevent permanent blocking
      const userPromise = firstValueFrom(this.githubApi.getAuthenticatedUser());
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Validation timeout')), 10000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as GitHubUser;
      this._user.set(user);
    } catch (err: any) {
      console.error('Validation failed', err);
      this.logout();
    } finally {
      this._isValidating.set(false);
    }
  }

  private loadToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private saveToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // silently fail
    }
  }

  private clearToken(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // silently fail
    }
  }
}
