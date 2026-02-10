import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim() || isSubmitting) return;

    setError('');
    setIsSubmitting(true);

    try {
      await login(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error && err.message !== 'Authentication failed'
          ? err.message
          : 'Invalid password'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="flex flex-col items-center mb-6">
          <Shield className="w-12 h-12 text-primary mb-3" />
          <h1 className="text-xl font-bold">SecureYeoman</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your admin password to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              disabled={isSubmitting}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm
                         placeholder:text-muted-foreground
                         focus:outline-none focus:ring-2 focus:ring-ring
                         disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={!password.trim() || isSubmitting}
            className="btn btn-primary w-full flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Local Network Only
        </p>
      </div>
    </div>
  );
}
