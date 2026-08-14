'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';
import { CreditCard, Check, Crown, Zap } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  interval: string;
  maxEvents: number;
  maxTicketsPerEvent: number;
  features: string[];
  _count: { subscriptions: number };
  sortOrder: number;
}

const planIcons: Record<string, any> = {
  free: Zap,
  starter: Zap,
  pro: Crown,
  enterprise: CreditCard,
};

export function AdminPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ plans: Plan[] }>('/api/subscription-plans')
      .then(data => setPlans(data.plans || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Subscription Plans</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-80" />)}
        </div>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Subscription Plans</h1>
        <Card className="p-12 text-center">
          <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No plans configured</h3>
          <p className="text-muted-foreground text-sm">Subscription plans can be configured via the database.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Subscription Plans</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map(plan => {
          const Icon = planIcons[plan.name.toLowerCase()] || CreditCard;
          const isPopular = plan.name.toLowerCase() === 'pro';
          return (
            <Card key={plan.id} className={`relative ${isPopular ? 'border-emerald-500 border-2 shadow-lg' : ''}`}>
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-emerald-600">Most Popular</Badge>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-2 p-3 rounded-full bg-emerald-50 text-emerald-600">
                  <Icon className="h-6 w-6" />
                </div>
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                {plan.description && <CardDescription>{plan.description}</CardDescription>}
                <div className="mt-2">
                  <span className="text-3xl font-bold">${plan.price.toFixed(2)}</span>
                  {plan.interval && <span className="text-muted-foreground text-sm">/{plan.interval}</span>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-center text-muted-foreground">
                  <span className="font-semibold text-foreground">{plan._count?.subscriptions || 0}</span> subscriber{(plan._count?.subscriptions || 0) !== 1 ? 's' : ''}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /><span>Up to {plan.maxEvents} events</span></div>
                  <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /><span>Up to {plan.maxTicketsPerEvent} tickets/event</span></div>
                  {(plan.features || []).map((f, i) => (
                    <div key={i} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /><span>{f}</span></div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
