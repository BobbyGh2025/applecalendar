'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Search, UserCog, Ban, Shield } from 'lucide-react';
import { format } from 'date-fns';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [actionType, setActionType] = useState<'toggle' | 'role'>('toggle');
  const [newRole, setNewRole] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '50' });
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      const data = await apiFetch<{ users: User[]; totalPages: number }>(`/api/admin?type=users&${params.toString()}`);
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleToggleActive = async () => {
    if (!targetUser) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/users/${targetUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !targetUser.isActive }),
      });
      toast.success(`User ${targetUser.isActive ? 'deactivated' : 'activated'}`);
      setTargetUser(null);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeRole = async () => {
    if (!targetUser || !newRole) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/users/${targetUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      toast.success(`Role updated to ${newRole}`);
      setTargetUser(null);
      setNewRole('');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">User Management</h1>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="All Roles" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Roles</SelectItem>
            <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
            <SelectItem value="ORGANIZER">Organizer</SelectItem>
            <SelectItem value="STAFF">Staff</SelectItem>
            <SelectItem value="PUBLIC">Public</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Shield className="h-10 w-10 mx-auto mb-3" />
              <p>No users found</p>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                      <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                      <TableCell>
                        <Badge className={u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(u.createdAt), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline" size="sm"
                            onClick={() => { setTargetUser(u); setActionType('toggle'); }}
                            className={u.isActive ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'}
                          >
                            {u.isActive ? <Ban className="h-4 w-4" /> : <UserCog className="h-4 w-4" />}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setTargetUser(u); setActionType('role'); }}>
                            <Shield className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toggle Active Dialog */}
      <AlertDialog open={targetUser !== null && actionType === 'toggle'} onOpenChange={o => { if (!o) setTargetUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{targetUser?.isActive ? 'Deactivate User' : 'Activate User'}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {targetUser?.isActive ? 'deactivate' : 'activate'} {targetUser?.name}? {targetUser?.isActive ? 'They will no longer be able to access the platform.' : 'They will regain access to the platform.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleActive} disabled={submitting}>
              {targetUser?.isActive ? 'Deactivate' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Role Dialog */}
      <AlertDialog open={targetUser !== null && actionType === 'role'} onOpenChange={o => { if (!o) { setTargetUser(null); setNewRole(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Role for {targetUser?.name}</AlertDialogTitle>
            <AlertDialogDescription>Select a new role for this user.</AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={newRole} onValueChange={setNewRole}>
            <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PUBLIC">Public</SelectItem>
              <SelectItem value="ORGANIZER">Organizer</SelectItem>
              <SelectItem value="STAFF">Staff</SelectItem>
              <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleChangeRole} disabled={submitting || !newRole}>Update Role</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="flex items-center px-4 text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}