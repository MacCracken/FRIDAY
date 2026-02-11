import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';

export function useSessionTimeout(expiresInSeconds: number = 3600) {
  const [showWarning, setShowWarning] = useState(false);
  const { logout } = useAuth();

  useEffect(() => {
    const warnMs = Math.max(0, (expiresInSeconds - 300) * 1000);
    const logoutMs = expiresInSeconds * 1000;

    const warnTimer = setTimeout(() => setShowWarning(true), warnMs);
    const logoutTimer = setTimeout(() => { void logout(); }, logoutMs);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
    };
  }, [expiresInSeconds, logout]);

  const dismiss = useCallback(() => setShowWarning(false), []);

  return { showWarning, dismiss };
}
