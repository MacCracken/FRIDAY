import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  login as apiLogin,
  logout as apiLogout,
  setAuthTokens,
  clearAuthTokens,
  getAccessToken,
  setOnAuthFailure,
} from '../api/client';

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const handleAuthFailure = useCallback(() => {
    setToken(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    setOnAuthFailure(handleAuthFailure);
  }, [handleAuthFailure]);

  useEffect(() => {
    // Check for existing token on mount
    const existing = getAccessToken();
    setToken(existing);
    setIsLoading(false);
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await apiLogin(password);
    setAuthTokens(result.accessToken, result.refreshToken);
    setToken(result.accessToken);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setToken(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <AuthContext.Provider
      value={{
        token,
        isAuthenticated: !!token,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
