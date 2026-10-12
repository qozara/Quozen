import { createContext, useContext, useState, ReactNode } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { setAuthToken, getAuthToken as getTokenFromStore } from '../lib/tokenStore';
import { quozen } from '../lib/storage';
import { User } from '@quozen/core';

const USER_STORAGE_KEY = "quozen_user_profile";

// User type imported from ../lib/storage/types

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initialize user from localStorage if available
  const [user, setUserState] = useState<User | null>(() => {
    const savedUser = localStorage.getItem(USER_STORAGE_KEY);
    try {
      return savedUser ? JSON.parse(savedUser) : null;
    } catch (e) {
      return null;
    }
  });

  const [token, _setToken] = useState<string | null>(() => getTokenFromStore());
  const [isLoading, setIsLoading] = useState(false);

  const setToken = (newToken: string | null) => {
    setAuthToken(newToken);
    _setToken(newToken);
  };

  const setUser = (newUser: User | null) => {
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
      setToken(accessToken);
      setIsLoading(true);

      try {
        // Fetch user profile from Google
        const userInfo = await axios.get(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        setUser({
          id: userInfo.data.sub,
          username: userInfo.data.email, // Use email as username
          email: userInfo.data.email,
          name: userInfo.data.name,
          picture: userInfo.data.picture
        });
        try {
          if (quozen.syncProvider) {
            await quozen.syncProvider.initialize();
          }
        } catch {
          // Ignore sync provider init errors during login
        }
      } catch (error) {
        console.error("Failed to fetch user info", error);
        logout();
      } finally {
        setIsLoading(false);
      }
    },
    onError: error => console.error('Login Failed:', error),
    // Request scopes for Google Sheets and Drive (drive.file for spreadsheets, drive.appdata for private settings)
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata',
  });

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!token && !!user,
      isLoading,
      token,
      login,
      logout
    }}>
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
