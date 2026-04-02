import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated() || authService.isValidating()) {
    return true;
  }

  // Check if we have a token that might still be validating
  if (authService.token()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};
