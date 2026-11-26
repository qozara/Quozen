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

function parseLegacyUser(): GoogleUserProfile | undefined {
  try {
    const rawUser = localStorage.getItem(LEGACY_USER_STORAGE_KEY);
    if (rawUser) {
      const parsed = JSON.parse(rawUser) as Record<string, unknown>;
      if (parsed && typeof parsed.email === 'string' && parsed.email.trim()) {
        return {
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
  return undefined;
}

function setMirroredLegacyToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(LEGACY_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota/access errors
  }
}

export function migrateLegacyQuozenSession(): GoogleSession | null {
  if (typeof localStorage === 'undefined') return null;

  const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY)?.trim() || null;
  const existing = quozenGoogleSessionStore.getSession();

  if (existing) {
    const expired = quozenGoogleSessionStore.isExpired(existing);
    if (!expired) {
      if (legacyToken && legacyToken !== existing.accessToken) {
        return quozenGoogleSessionStore.setSession({
          accessToken: legacyToken,
          scopes: existing.scopes.length > 0 ? existing.scopes : GOOGLE_IDENTITY_AND_DRIVE_SCOPES,
          user: parseLegacyUser() ?? existing.user,
        });
      }
      setMirroredLegacyToken(existing.accessToken);
      return existing;
    }

    // Existing session is expired: only accept legacyToken if an external caller replaced it with a new token
    if (legacyToken && legacyToken !== existing.accessToken) {
      return quozenGoogleSessionStore.setSession({
        accessToken: legacyToken,
        scopes: existing.scopes.length > 0 ? existing.scopes : GOOGLE_IDENTITY_AND_DRIVE_SCOPES,
        user: parseLegacyUser() ?? existing.user,
      });
    }

    setMirroredLegacyToken(null);
    return existing;
  }

  if (!legacyToken) {
    return null;
  }

  const migrated = quozenGoogleSessionStore.migrateFromLegacyCredentials(
    {
      accessToken: legacyToken,
      user: parseLegacyUser(),
    },
    GOOGLE_IDENTITY_AND_DRIVE_SCOPES
  );

  if (migrated && !quozenGoogleSessionStore.isExpired(migrated)) {
    setMirroredLegacyToken(migrated.accessToken);
  } else {
    setMirroredLegacyToken(null);
  }

  return migrated;
}

export const setAuthToken = (token: string | null, options?: SetAuthTokenOptions): void => {
  if (token && token.trim()) {
    const trimmed = token.trim();
    const saved = quozenGoogleSessionStore.setSession({
      accessToken: trimmed,
      expiresInSeconds: options?.expiresInSeconds,
      expiresAt: options?.expiresAt,
      scopes: options?.scopes ?? GOOGLE_IDENTITY_AND_DRIVE_SCOPES,
      user: options?.user,
    });
    setMirroredLegacyToken(quozenGoogleSessionStore.isExpired(saved) ? null : trimmed);
  } else {
    quozenGoogleSessionStore.clearSession();
    setMirroredLegacyToken(null);
  }
};

export const getAuthToken = (): string | null => {
  migrateLegacyQuozenSession();
  const valid = quozenGoogleSessionStore.getValidAccessToken();
  if (!valid) {
    setMirroredLegacyToken(null);
  }
  return valid;
};
