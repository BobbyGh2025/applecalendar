'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Megaphone, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface Ad {
  id: string;
  title: string;
  imageUrl: string | null;
  linkUrl: string | null;
  position: string;
  status: string;
  impressions: number;
  clicks: number;
  startDate: string;
  endDate: string | null;
}

const defaultForm = {
  title: '',
  imageUrl: '',
  linkUrl: '',
  position: 'SIDEBAR',
  startDate: '',
  endDate: '',
};

export function AdsManagement({ title }: { title: string }) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ ads: Ad[] }>('/api/ads');
      setAds(data.ads || []);
    } catch {
      toast.error('Failed to load ads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAds(); }, [fetchAds]);

  const openCreate = () => { setForm(defaultForm); setEditingId(null); setDialogOpen(true); };
  const openEdit = (ad: Ad) => {
    setForm({
      title: ad.title,
      imageUrl: ad.imageUrl || '',
      linkUrl: ad.linkUrl || '',
      position: ad.position,
      startDate: ad.startDate ? format(new Date(ad.startDate), 'yyyy-MM-dd') : '',
      endDate: ad.endDate ? format(new Date(ad.endDate), 'yyyy-MM-dd') : '',
    });
    setEditingId(ad.id);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.title) { toast.error('Title is required'); return; }
    setSubmitting(true);
    try {
      const body: any = { ...form, startDate: form.startDate || undefined, endDate: form.endDate || undefined };
      if (editingId) {
        await apiFetch(`/api/ads/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success('Ad updated');
      } else {
        await apiFetch('/api/ads', { method: 'POST', body: JSON.stringify(body) });
        toast.success('Ad created');
      }
      setDialogOpen(false);
      fetchAds();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await apiFetch(`/api/ads/${deleteId}`, { method: 'DELETE' });
      toast.success('Ad deleted');
      setDeleteId(null);
      fetchAds();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{title}</h1>
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Create Ad</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : ads.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Megaphone className="h-10 w-10 mx-auto mb-3" />
              <p>No advertisements yet</p>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Impressions</TableHead>
                    <TableHead>Clicks</TableHead>
                    <TableHead>CTR</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ads.map(ad => (
                    <TableRow key={ad.id}>
                      <TableCell className="font-medium">{ad.title}</TableCell>
                      <TableCell><Badge variant="outline">{ad.position}</Badge></TableCell>
                      <TableCell><Badge className={ad.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>{ad.status}</Badge></TableCell>
                      <TableCell>{(ad.impressions || 0).toLocaleString()}</TableCell>
                      <TableCell>{(ad.clicks || 0).toLocaleString()}</TableCell>
                      <TableCell>{ad.impressions > 0 ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : 0}%</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => openEdit(ad)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="outline" size="sm" className="text-red-600" onClick={() => setDeleteId(ad.id)}><Trash2 className="h-4 w-4" /></Button>
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

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Ad' : 'Create Ad'}</DialogTitle>
            <DialogDescription>Fill in the advertisement details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Title *</Label><Input value={form.title} onChange={e => updateForm('title', e.target.value)} /></div>
            <div className="space-y-2"><Label>Image URL</Label><Input value={form.imageUrl} onChange={e => updateForm('imageUrl', e.target.value)} /></div>
            <div className="space-y-2"><Label>Link URL</Label><Input value={form.linkUrl} onChange={e => updateForm('linkUrl', e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Position</Label>
              <Select value={form.position} onValueChange={v => updateForm('position', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SIDEBAR">Sidebar</SelectItem>
                  <SelectItem value="BANNER">Banner</SelectItem>
                  <SelectItem value="HERO">Hero</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e => updateForm('startDate', e.target.value)} /></div>
              <div className="space-y-2"><Label>End Date</Label><Input type="date" value={form.endDate} onChange={e => updateForm('endDate', e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Advertisement</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this ad? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
