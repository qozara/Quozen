import {
  GoogleSessionStore,
  GOOGLE_IDENTITY_AND_DRIVE_SCOPES,
  type GoogleSession,
  type GoogleUserProfile,
} from '@qozara/google-auth';

const LEGACY_TOKEN_KEY = 'quozen_access_token';
const LEGACY_USER_STORAGE_KEY = 'quozen_user_profile';

export const quozenGoogleSessionStore = new GoogleSessionStore();

export interface SetAuthTokenOptions {
  expiresInSeconds?: number;
  expiresAt?: number;
  scopes?: string | readonly string[];
  user?: GoogleUserProfile;
}

export function migrateLegacyQuozenSession(): GoogleSession | null {
  if (typeof localStorage === 'undefined') return null;

  const existing = quozenGoogleSessionStore.getSession();
  if (existing && !quozenGoogleSessionStore.isExpired(existing)) {
    return existing;
  }

  const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacyToken || !legacyToken.trim()) {
    return existing;
  }

  let legacyUser: GoogleUserProfile | undefined;
  try {
    const rawUser = localStorage.getItem(LEGACY_USER_STORAGE_KEY);
    if (rawUser) {
      const parsed = JSON.parse(rawUser) as Record<string, unknown>;
      if (parsed && typeof parsed.email === 'string' && parsed.email.trim()) {
        legacyUser = {
          email: parsed.email.trim().toLowerCase(),
          ...(typeof parsed.id === 'string' && parsed.id ? { id: parsed.id } : {}),
          ...(typeof parsed.name === 'string' && parsed.name ? { name: parsed.name } : {}),
          ...(typeof parsed.picture === 'string' && parsed.picture ? { picture: parsed.picture } : {}),
        };
      }
    }
  } catch {
    // Ignore malformed legacy user JSON
  }

  const migrated = quozenGoogleSessionStore.migrateFromLegacyCredentials(
    {
      accessToken: legacyToken.trim(),
      user: legacyUser,
    },
    GOOGLE_IDENTITY_AND_DRIVE_SCOPES
  );

  // Remove legacy raw token key once migrated so expired legacy tokens cannot resurrect on reload
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Ignore storage removal errors
  }

  return migrated;
}

export const setAuthToken = (token: string | null, options?: SetAuthTokenOptions): void => {
  if (token && token.trim()) {
    quozenGoogleSessionStore.setSession({
      accessToken: token.trim(),
      expiresInSeconds: options?.expiresInSeconds,
      expiresAt: options?.expiresAt,
      scopes: options?.scopes ?? GOOGLE_IDENTITY_AND_DRIVE_SCOPES,
      user: options?.user,
    });
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  } else {
    quozenGoogleSessionStore.clearSession();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  }
};

export const getAuthToken = (): string | null => {
  migrateLegacyQuozenSession();
  return quozenGoogleSessionStore.getValidAccessToken();
};
