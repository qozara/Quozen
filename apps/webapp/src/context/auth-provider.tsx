import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  fetchGoogleUserProfile,
  formatScopeString,
  GOOGLE_IDENTITY_AND_DRIVE_SCOPES,
} from '@qozara/google-auth';
import {
  quozenGoogleSessionStore,
  migrateLegacyQuozenSession,
  setAuthToken,
  getAuthToken as getTokenFromStore,
} from '../lib/tokenStore';
import { quozen, resetQuozenStorage } from '../lib/storage';
import { User } from '@quozen/core';

const USER_STORAGE_KEY = 'quozen_user_profile';
const QUOZEN_OAUTH_SCOPE = formatScopeString(GOOGLE_IDENTITY_AND_DRIVE_SCOPES);

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function readInitialUser(): User | null {
  const session = migrateLegacyQuozenSession() ?? quozenGoogleSessionStore.getSession();
  if (session?.user?.email) {
    return {
      id: session.user.id || session.user.email,
      username: session.user.email,
      email: session.user.email,
      name: session.user.name || session.user.email,
      picture: session.user.picture,
    };
  }
  const savedUser = localStorage.getItem(USER_STORAGE_KEY);
  try {
    return savedUser ? JSON.parse(savedUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => readInitialUser());
  const [token, _setToken] = useState<string | null>(() => getTokenFromStore());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    return quozenGoogleSessionStore.subscribe((nextSession) => {
      const validToken = quozenGoogleSessionStore.getValidAccessToken();
      _setToken(validToken);
      if (!nextSession) {
        setUserState(null);
      } else if (nextSession.user?.email) {
        setUserState({
          id: nextSession.user.id || nextSession.user.email,
          username: nextSession.user.email,
          email: nextSession.user.email,
          name: nextSession.user.name || nextSession.user.email,
          picture: nextSession.user.picture,
        });
      }
    });
  }, []);

  const persistUser = (newUser: User | null) => {
    if (newUser) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
    setUserState(newUser);
  };

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse.access_token;
      setIsLoading(true);

      try {
        const profile = await fetchGoogleUserProfile(accessToken);
        const mappedUser: User = {
          id: profile.id || profile.email,
          username: profile.email,
          email: profile.email,
          name: profile.name || profile.email,
          picture: profile.picture,
        };

        setAuthToken(accessToken, {
          expiresInSeconds: tokenResponse.expires_in,
          scopes: tokenResponse.scope || GOOGLE_IDENTITY_AND_DRIVE_SCOPES,
          user: profile,
        });
        _setToken(accessToken);
        persistUser(mappedUser);

        try {
          if (quozen.syncProvider) {
            await quozen.syncProvider.initialize();
          }
        } catch {
          // Ignore sync provider init errors during login
        }
      } catch (error) {
        console.error('Failed to fetch user info', error);
        logout();
      } finally {
        setIsLoading(false);
      }
    },
    onError: (error) => console.error('Login Failed:', error),
    scope: QUOZEN_OAUTH_SCOPE,
    include_granted_scopes: true,
  });

  const logout = () => {
    setAuthToken(null);
    _setToken(null);
    persistUser(null);
    void resetQuozenStorage();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!token && !!user,
        isLoading,
        token,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useOptionalAuth = () => useContext(AuthContext);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
