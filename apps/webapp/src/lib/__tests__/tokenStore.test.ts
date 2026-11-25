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

  it('stores valid token, mirrors active key, enforces expiry purge, and clears cleanly on logout', () => {
    setAuthToken('ya29.valid-quozen-tok', {
      expiresInSeconds: 3600,
      user: { email: 'alice@qozara.org', name: 'Alice' },
    });

    expect(getAuthToken()).toBe('ya29.valid-quozen-tok');
    expect(localStorage.getItem('quozen_access_token')).toBe('ya29.valid-quozen-tok');
    expect(quozenGoogleSessionStore.getSession()?.user?.email).toBe('alice@qozara.org');

    // Expired token must return null AND purge stale mirrored key so expired tokens never resurrect
    setAuthToken('ya29.expired-quozen-tok', {
      expiresAt: Date.now() - 10_000,
    });
    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem('quozen_access_token')).toBeNull();

    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem('quozen_access_token')).toBeNull();
    expect(quozenGoogleSessionStore.getSession()).toBeNull();
  });

  it('migrates legacy quozen_access_token and quozen_user_profile while keeping active mirror synced', () => {
    localStorage.setItem('quozen_access_token', 'mock-token-123');
    localStorage.setItem(
      'quozen_user_profile',
      JSON.stringify({ id: 'u1', email: 'legacy@qozara.org', name: 'Legacy User' })
    );

    expect(getAuthToken()).toBe('mock-token-123');
    expect(localStorage.getItem('quozen_access_token')).toBe('mock-token-123');
    expect(quozenGoogleSessionStore.getSession()?.user).toEqual({
      id: 'u1',
      email: 'legacy@qozara.org',
      name: 'Legacy User',
    });
  });
});
