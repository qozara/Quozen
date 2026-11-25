/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  quozenGoogleSessionStore,
  setAuthToken,
  getAuthToken,
} from '../tokenStore';

describe('Quozen tokenStore (@qozara/google-auth backed)', () => {
  beforeEach(() => {
    localStorage.clear();
    quozenGoogleSessionStore.clearSession();
  });

  it('stores valid token, enforces expiry, and clears cleanly on logout', () => {
    setAuthToken('ya29.valid-quozen-tok', {
      expiresInSeconds: 3600,
      user: { email: 'alice@qozara.org', name: 'Alice' },
    });

    expect(getAuthToken()).toBe('ya29.valid-quozen-tok');
    expect(quozenGoogleSessionStore.getSession()?.user?.email).toBe('alice@qozara.org');

    // Expired token must return null rather than forwarding a dead token
    setAuthToken('ya29.expired-quozen-tok', {
      expiresAt: Date.now() - 10_000,
    });
    expect(getAuthToken()).toBeNull();

    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
    expect(quozenGoogleSessionStore.getSession()).toBeNull();
  });

  it('migrates legacy quozen_access_token and quozen_user_profile idempotently and removes raw legacy key', () => {
    localStorage.setItem('quozen_access_token', 'ya29.legacy-tok');
    localStorage.setItem(
      'quozen_user_profile',
      JSON.stringify({ id: 'u1', email: 'legacy@qozara.org', name: 'Legacy User' })
    );

    expect(getAuthToken()).toBe('ya29.legacy-tok');
    expect(localStorage.getItem('quozen_access_token')).toBeNull();
    expect(quozenGoogleSessionStore.getSession()?.user).toEqual({
      id: 'u1',
      email: 'legacy@qozara.org',
      name: 'Legacy User',
    });
  });
});
