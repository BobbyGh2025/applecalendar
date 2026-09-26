'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/stores/app-store';
import { apiFetch, ApiFetchError } from '@/lib/api';
import { toast } from 'sonner';
import {
  Search,
  CheckCircle,
  XCircle,
  PauseCircle,
  RotateCcw,
  PowerOff,
  Building2,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

type OrganizerStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'DEACTIVATED';

interface Organizer {
  id: string;
  organizationName: string;
  slug: string;
  status: OrganizerStatus;
  statusReason?: string | null;
  statusChangedAt?: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  organizerSubscription?: {
    plan: {
      name: string;
    };
  } | null;
}

interface OrganizersResponse {
  organizers: Organizer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_COLORS: Record<OrganizerStatus, string> = {
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  ACTIVE: 'bg-green-100 text-green-700 border-green-200',
  REJECTED: 'bg-red-100 text-red-700 border-red-200',
  SUSPENDED: 'bg-orange-100 text-orange-700 border-orange-200',
  DEACTIVATED: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_LABELS: Record<OrganizerStatus, string> = {
  PENDING_APPROVAL: 'Pending Approval',
  ACTIVE: 'Active',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
};

export function AdminOrganizers() {
  const { token } = useAppStore();

  // List state
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedStatus, setAppliedStatus] = useState<string>('ALL');

  // Dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    organizer: Organizer | null;
    action: 'approve' | 'reinstate' | null;
  }>({ open: false, organizer: null, action: null });

  const [reasonDialog, setReasonDialog] = useState<{
    open: boolean;
    organizer: Organizer | null;
    action: 'reject' | 'suspend' | 'deactivate' | null;
    reason: string;
  }>({ open: false, organizer: null, action: null, reason: '' });

  const [actionLoading, setActionLoading] = useState(false);

  const LIMIT = 10;

  const fetchOrganizers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      if (appliedStatus !== 'ALL') params.set('status', appliedStatus);
      if (appliedSearch) params.set('search', appliedSearch);

      const res = await apiFetch<OrganizersResponse>(
        `/api/admin/organizers?${params.toString()}`
      );
      setOrganizers(res.organizers || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      if (err instanceof ApiFetchError && err.isEntitlementError) {
        toast.error(err.message);
      } else {
        toast.error('Failed to load organizers');
      }
      setOrganizers([]);
    } finally {
      setLoading(false);
    }
  }, [page, appliedSearch, appliedStatus]);

  useEffect(() => {
    fetchOrganizers();
  }, [fetchOrganizers]);

  // Search handler
  const handleSearch = () => {
    setAppliedSearch(search);
    setAppliedStatus(statusFilter);
    setPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleStatusFilterChange = (val: string) => {
    setStatusFilter(val);
    setAppliedStatus(val);
    setAppliedSearch(search);
    setPage(1);
  };

  // Action handlers
  const executeAction = async (
    organizerId: string,
    action: string,
    body?: Record<string, string>
  ) => {
    setActionLoading(true);
    try {
      await apiFetch(`/api/admin/organizers/${organizerId}/${action}`, {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      });
      toast.success(`Action completed successfully`);
      fetchOrganizers();
    } catch (err) {
      if (err instanceof ApiFetchError && err.isEntitlementError) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : 'Action failed');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog.organizer || !confirmDialog.action) return;
    await executeAction(confirmDialog.organizer.id, confirmDialog.action);
    setConfirmDialog({ open: false, organizer: null, action: null });
  };

  const handleReasonAction = async () => {
    if (!reasonDialog.organizer || !reasonDialog.action) return;
    if (!reasonDialog.reason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    await executeAction(reasonDialog.organizer.id, reasonDialog.action, {
      reason: reasonDialog.reason.trim(),
    });
    setReasonDialog({ open: false, organizer: null, action: null, reason: '' });
  };

  const openApprove = (org: Organizer) =>
    setConfirmDialog({ open: true, organizer: org, action: 'approve' });

  const openReject = (org: Organizer) =>
    setReasonDialog({ open: true, organizer: org, action: 'reject', reason: '' });

  const openSuspend = (org: Organizer) =>
    setReasonDialog({ open: true, organizer: org, action: 'suspend', reason: '' });

  const openReinstate = (org: Organizer) =>
    setConfirmDialog({ open: true, organizer: org, action: 'reinstate' });

  const openDeactivate = (org: Organizer) =>
    setReasonDialog({ open: true, organizer: org, action: 'deactivate', reason: '' });

  const renderActions = (org: Organizer) => {
    switch (org.status) {
      case 'PENDING_APPROVAL':
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-green-600 hover:text-green-700 h-8"
              onClick={() => openApprove(org)}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-red-600 hover:text-red-700 h-8"
              onClick={() => openReject(org)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        );
      case 'ACTIVE':
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-orange-600 hover:text-orange-700 h-8"
              onClick={() => openSuspend(org)}
            >
              <PauseCircle className="h-3.5 w-3.5" />
              Suspend
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-gray-600 hover:text-gray-700 h-8"
              onClick={() => openDeactivate(org)}
            >
              <PowerOff className="h-3.5 w-3.5" />
              Deactivate
            </Button>
          </div>
        );
      case 'SUSPENDED':
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-green-600 hover:text-green-700 h-8"
              onClick={() => openReinstate(org)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reinstate
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-gray-600 hover:text-gray-700 h-8"
              onClick={() => openDeactivate(org)}
            >
              <PowerOff className="h-3.5 w-3.5" />
              Deactivate
            </Button>
          </div>
        );
      case 'REJECTED':
      case 'DEACTIVATED':
        return (
          <span className="text-xs text-muted-foreground">No actions</span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
          <Building2 className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Organizer Management</h1>
          <p className="text-sm text-muted-foreground">
            Review, approve, and manage organizer accounts
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 items-center">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  <SelectItem value="DEACTIVATED">Deactivated</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleSearch} size="sm" className="gap-1">
                <Search className="h-3.5 w-3.5" />
                Search
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organizers Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">
            Organizers
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({total} total)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : organizers.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-lg font-medium">No organizers found</p>
              <p className="text-sm mt-1">
                Try adjusting your search or filter criteria
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizers.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell className="font-medium text-sm">
                        {org.organizationName}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {org.user?.name || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {org.user?.email || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_COLORS[org.status]}
                        >
                          {STATUS_LABELS[org.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {org.organizerSubscription?.plan?.name || (
                          <span className="text-muted-foreground">Free</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(org.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>{renderActions(org)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Confirm Dialog (Approve / Reinstate) */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          !open && setConfirmDialog({ open: false, organizer: null, action: null })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog.action === 'approve'
                ? 'Approve Organizer'
                : 'Reinstate Organizer'}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.action === 'approve'
                ? `Are you sure you want to approve "${confirmDialog.organizer?.organizationName}"? They will be able to create and publish events.`
                : `Are you sure you want to reinstate "${confirmDialog.organizer?.organizationName}"? Their account will be reactivated.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setConfirmDialog({ open: false, organizer: null, action: null })
              }
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAction}
              disabled={actionLoading}
              className="gap-1"
            >
              {actionLoading ? (
                <span className="animate-spin">⏳</span>
              ) : confirmDialog.action === 'approve' ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {confirmDialog.action === 'approve' ? 'Approve' : 'Reinstate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reason Dialog (Reject / Suspend / Deactivate) */}
      <Dialog
        open={reasonDialog.open}
        onOpenChange={(open) =>
          !open &&
          setReasonDialog({ open: false, organizer: null, action: null, reason: '' })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonDialog.action === 'reject'
                ? 'Reject Organizer'
                : reasonDialog.action === 'suspend'
                  ? 'Suspend Organizer'
                  : 'Deactivate Organizer'}
            </DialogTitle>
            <DialogDescription>
              {reasonDialog.action === 'reject'
                ? `Reject the application from "${reasonDialog.organizer?.organizationName}". The organizer will be notified.`
                : reasonDialog.action === 'suspend'
                  ? `Suspend "${reasonDialog.organizer?.organizationName}". They will not be able to create or manage events.`
                  : `Deactivate "${reasonDialog.organizer?.organizationName}". This is a more permanent action.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                A reason is required for this action.
              </p>
            </div>
            <Textarea
              placeholder="Enter reason..."
              value={reasonDialog.reason}
              onChange={(e) =>
                setReasonDialog((prev) => ({ ...prev, reason: e.target.value }))
              }
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setReasonDialog({
                  open: false,
                  organizer: null,
                  action: null,
                  reason: '',
                })
              }
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReasonAction}
              disabled={actionLoading || !reasonDialog.reason.trim()}
              className="gap-1"
            >
              {actionLoading ? (
                <span className="animate-spin">⏳</span>
              ) : reasonDialog.action === 'reject' ? (
                <XCircle className="h-4 w-4" />
              ) : reasonDialog.action === 'suspend' ? (
                <PauseCircle className="h-4 w-4" />
              ) : (
                <PowerOff className="h-4 w-4" />
              )}
              {reasonDialog.action === 'reject'
                ? 'Reject'
                : reasonDialog.action === 'suspend'
                  ? 'Suspend'
                  : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
