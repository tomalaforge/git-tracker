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

  private readonly _token = signal<string | null>(this.loadTokenFromLocalStorage());
  private readonly _user = signal<GitHubUser | null>(null);
  private readonly _isValidating = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isValidating = this._isValidating.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => !!this._token() && !!this._user());

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // 1. Check if we have a token in Electron storage (more robust)
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.loadToken) {
      const persistentToken = await electronAPI.loadToken();
      if (persistentToken && persistentToken !== this._token()) {
        this._token.set(persistentToken);
        this.saveTokenToLocalStorage(persistentToken);
      }
    }

    // 2. If we have a token (from either source), validate it
    if (this._token()) {
      await this.validateToken();
    }
  }

  async login(token: string): Promise<boolean> {
    this._isValidating.set(true);
    this._error.set(null);
    this._token.set(token);

    try {
      const user = await firstValueFrom(this.githubApi.getAuthenticatedUser());
      this._user.set(user);
      await this.saveToken(token);
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
      // Timeout after 10 seconds to prevent permanent blocking
      const userPromise = firstValueFrom(this.githubApi.getAuthenticatedUser());
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Validation timeout')), 10000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as GitHubUser;
      this._user.set(user);
    } catch (err: any) {
      console.error('Validation failed', err);
      // Only logout if it's a definitive authentication error (401)
      if (err?.status === 401) {
        this.logout();
      }
      // If it's a network error or timeout, we keep the token and the user
      // has to manually logout or wait for a successful refresh later.
    } finally {
      this._isValidating.set(false);
    }
  }

  private loadTokenFromLocalStorage(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private saveTokenToLocalStorage(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // silently fail
    }
  }

  private async saveToken(token: string): Promise<void> {
    // Save to localStorage
    this.saveTokenToLocalStorage(token);

    // Save to Electron storage (async)
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.saveToken) {
      await electronAPI.saveToken(token);
    }
  }

  private async clearToken(): Promise<void> {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }

    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.clearToken) {
      await electronAPI.clearToken();
    }
  }
}
