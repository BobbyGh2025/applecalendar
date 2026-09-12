'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MailCheck,
  MailX,
  Loader2,
  Send,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Email Verification View ───

export function EmailVerificationView() {
  const { user, navigate } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Check email verification status
  const [verified, setVerified] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkStatus() {
      try {
        const data = await apiFetch<{ success: boolean; user: { emailVerified: string | null } }>('/api/users/me');
        if (data.success && data.user) {
          setVerified(!!data.user.emailVerified);
        }
      } catch {
        // If unauthenticated, just show the form
        setVerified(null);
      } finally {
        setChecking(false);
      }
    }
    checkStatus();
  }, []);

  // Cooldown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleVerify = async () => {
    if (!tokenInput.trim()) {
      toast.error('Please enter the verification token');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ success: boolean; message: string; alreadyVerified?: boolean }>(
        '/api/auth/verify-email',
        {
          method: 'POST',
          body: JSON.stringify({ token: tokenInput.trim() }),
        },
      );
      if (data.success) {
        setVerified(true);
        toast.success(data.message);
      } else {
        toast.error(data.message || 'Verification failed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    try {
      const data = await apiFetch<{ success: boolean; message: string; devToken?: string }>(
        '/api/auth/resend-verification',
        { method: 'POST' },
      );
      if (data.success) {
        toast.success('Verification email sent!', {
          description: 'Check your email for a new verification link.',
        });
        // In dev mode, auto-fill the token
        if (data.devToken) {
          setTokenInput(data.devToken);
        }
        setResendCooldown(60); // 60-second cooldown
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend verification');
    } finally {
      setResendLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  // Already verified state
  if (verified) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <MailCheck className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-semibold">Email Verified</h2>
            <p className="text-muted-foreground">
              Your email address <span className="font-medium">{user?.email}</span> has been verified.
              You have full access to all features.
            </p>
            <Button
              onClick={() => navigate('profile')}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Account Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not verified — show verification form
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Verify Your Email</h1>
        <p className="text-muted-foreground mt-1">
          Confirm your email address to get full access to all features.
        </p>
      </div>

      {/* Status Banner */}
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <MailX className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-900">Email not verified</p>
              <p className="text-sm text-amber-700 mt-1">
                {user?.email ? (
                  <>Your email <span className="font-medium">{user.email}</span> has not been verified yet.</>
                ) : (
                  'Please verify your email address to activate your account.'
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Token Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enter Verification Token</CardTitle>
          <CardDescription>
            Paste the token from your verification email, or enter it manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="verification-token">Verification Token</Label>
            <Input
              id="verification-token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste your verification token here"
              className="font-mono text-sm"
            />
          </div>
          <Button
            onClick={handleVerify}
            disabled={loading || !tokenInput.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Verify Email
          </Button>
        </CardContent>
      </Card>

      {/* Resend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resend Verification Email</CardTitle>
          <CardDescription>
            Didn&apos;t receive the email? Request a new verification link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={handleResend}
            disabled={resendLoading || resendCooldown > 0}
            className="w-full"
          >
            {resendLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : 'Resend Verification Email'}
          </Button>
        </CardContent>
      </Card>

      <div className="text-center">
        <button
          onClick={() => navigate('profile')}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 inline mr-1" />
          Back to Account Settings
        </button>
      </div>
    </div>
  );
}

// ─── Compact Email Verification Banner ───
// For embedding in the profile view

export function EmailVerificationBanner({ emailVerified }: { emailVerified: string | null }) {
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { navigate } = useAppStore();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleResend = async () => {
    setResendLoading(true);
    try {
      const data = await apiFetch<{ success: boolean; message: string; devToken?: string }>(
        '/api/auth/resend-verification',
        { method: 'POST' },
      );
      if (data.success) {
        toast.success('Verification email sent!');
        setResendCooldown(60);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend');
    } finally {
      setResendLoading(false);
    }
  };

  if (emailVerified) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 bg-emerald-50">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Email Verified
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
        <AlertCircle className="h-3 w-3 mr-1" />
        Not Verified
      </Badge>
      <button
        onClick={() => navigate('verify-email')}
        className="text-xs text-emerald-600 hover:underline font-medium"
      >
        Verify now
      </button>
      <span className="text-xs text-muted-foreground">or</span>
      <button
        onClick={handleResend}
        disabled={resendLoading || resendCooldown > 0}
        className="text-xs text-emerald-600 hover:underline font-medium disabled:opacity-50 disabled:no-underline"
      >
        {resendCooldown > 0 ? `resend in ${resendCooldown}s` : 'resend email'}
      </button>
    </div>
  );
}
