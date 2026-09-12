'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  KeyRound,
  Loader2,
  Eye,
  EyeOff,
  ArrowLeft,
  CheckCircle2,
  Mail,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Password Strength Helper ───

function getPasswordStrength(password: string): {
  score: number;
  label: string;
  checks: { label: string; passed: boolean }[];
} {
  const checks = [
    { label: 'At least 8 characters', passed: password.length >= 8 },
    { label: 'Uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'Number', passed: /\d/.test(password) },
    { label: 'Special character', passed: /[^A-Za-z0-9]/.test(password) },
  ];

  const score = checks.filter((c) => c.passed).length;
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

  return { score, label: labels[score - 1] || 'Too Short', checks };
}

// ─── Forgot Password View ───

export function ForgotPasswordView() {
  const { navigate } = useAppStore();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Please enter your email address');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{
        success: boolean;
        message: string;
        devToken?: string;
      }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      if (data.success) {
        setSubmitted(true);
        if (data.devToken) {
          setDevToken(data.devToken);
        }
        toast.success('Reset request received', {
          description: data.message,
          duration: 6000,
        });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to request reset'
      );
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <Mail className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-semibold">Check Your Email</h2>
            <p className="text-muted-foreground">
              If an account exists with <span className="font-medium">{email}</span>, you&apos;ll
              receive a password reset link. The link expires in 60 minutes.
            </p>
            {devToken && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-left">
                <p className="text-xs font-medium text-amber-800 mb-1">
                  Dev Mode: Reset Token
                </p>
                <p className="text-xs font-mono text-amber-700 break-all">
                  {devToken}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => navigate('reset-password')}
                >
                  Go to Reset Password
                </Button>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => navigate('login')}
              className="mt-2"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Forgot Password?</h1>
        <p className="text-muted-foreground mt-1">
          Enter your email address and we&apos;ll send you a link to reset your
          password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-emerald-600" />
            Request Password Reset
          </CardTitle>
          <CardDescription>
            We&apos;ll send a reset link to your email if an account exists. The
            link expires in 60 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email Address</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={loading || !email.trim()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              Send Reset Link
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="text-center">
        <button
          onClick={() => navigate('login')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 inline mr-1" />
          Back to Login
        </button>
      </div>
    </div>
  );
}

// ─── Reset Password View ───

export function ResetPasswordView() {
  const { navigate } = useAppStore();
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionsRevoked, setSessionsRevoked] = useState<number | null>(null);

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit =
    token.trim() &&
    newPassword &&
    confirmPassword &&
    strength.score === 5 &&
    passwordsMatch;

  // Check URL hash for token (e.g. /reset-password#token=xxx)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#token=')) {
      setToken(hash.slice(7));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      const data = await apiFetch<{
        success: boolean;
        message: string;
        sessionsRevoked?: number;
      }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim(), newPassword }),
      });
      if (data.success) {
        setSuccess(true);
        setSessionsRevoked(data.sessionsRevoked ?? null);
        toast.success('Password reset successfully!', {
          description: 'Please log in with your new password.',
          duration: 6000,
        });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to reset password'
      );
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-semibold">Password Reset Complete</h2>
            <p className="text-muted-foreground">
              Your password has been changed successfully. Please log in with
              your new password.
            </p>
            {sessionsRevoked !== null && sessionsRevoked > 0 && (
              <div className="flex items-center justify-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <Shield className="h-4 w-4" />
                <span>
                  {sessionsRevoked} other session
                  {sessionsRevoked !== 1 ? 's' : ''} revoked for security
                </span>
              </div>
            )}
            <Button
              onClick={() => navigate('login')}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Log In Now
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reset Your Password</h1>
        <p className="text-muted-foreground mt-1">
          Enter the reset token from your email and choose a new password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-emerald-600" />
            Set New Password
          </CardTitle>
          <CardDescription>
            Paste the token from your reset email and enter your new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Token Input */}
            <div className="space-y-2">
              <Label htmlFor="reset-token">Reset Token</Label>
              <Input
                id="reset-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your reset token here"
                className="font-mono text-sm"
              />
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>

              {/* Strength indicator */}
              {newPassword && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Progress
                      value={(strength.score / 5) * 100}
                      className="h-2 flex-1"
                    />
                    <span
                      className={`text-xs font-medium ${
                        strength.score >= 4
                          ? 'text-emerald-600'
                          : strength.score >= 3
                          ? 'text-amber-600'
                          : 'text-red-500'
                      }`}
                    >
                      {strength.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {strength.checks.map((check) => (
                      <div
                        key={check.label}
                        className={`text-xs flex items-center gap-1 ${
                          check.passed
                            ? 'text-emerald-600'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {check.passed ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <span className="h-3 w-3 inline-block rounded-full border border-muted-foreground/30" />
                        )}
                        {check.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowConfirm(!showConfirm)}
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              {confirmPassword && !passwordsMatch && (
                <p className="text-xs text-red-500">Passwords do not match</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={loading || !canSubmit}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4 mr-2" />
              )}
              Reset Password
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="text-center">
        <button
          onClick={() => navigate('login')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 inline mr-1" />
          Back to Login
        </button>
      </div>
    </div>
  );
}
