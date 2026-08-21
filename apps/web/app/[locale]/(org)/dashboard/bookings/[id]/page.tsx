'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/navigation';
import { BackButton } from '@/components/back-button';
import {
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  User,
  UserX,
  XCircle,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { use, useCallback, useEffect, useState } from 'react';

interface BookingDetail {
  id: string;
  organization_id: string;
  court_id: string;
  player_id: string | null;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  price_cents: number | null;
  currency: string | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  stripe_payment_intent_id: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  refund_amount_cents: number | null;
  refund_status: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  court: {
    id: string;
    name: string | null;
    court_number: number | null;
    facility: {
      id: string;
      name: string;
      timezone: string;
    };
  } | null;
  player: {
    id: string;
    profile: {
      first_name: string | null;
      last_name: string | null;
      display_name: string | null;
      email?: string | null;
    } | null;
  } | null;
}

type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'awaiting_approval';

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: bookingId } = use(params);
  const locale = useLocale();
  const t = useTranslations('bookings');

  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Action dialogs
  const [cancelDialog, setCancelDialog] = useState(false);
  const [noShowDialog, setNoShowDialog] = useState(false);
  const [completeDialog, setCompleteDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchBooking = useCallback(async () => {
    try {
      const response = await fetch(`/api/bookings/${bookingId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch booking');
      }
      const data = await response.json();
      setBooking(data.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  const getPlayerName = (): string => {
    // If we have player profile info, use it
    if (booking?.player?.profile) {
      const { first_name, last_name, display_name } = booking.player.profile;
      if (display_name) return display_name;
      if (first_name || last_name) return `${first_name || ''} ${last_name || ''}`.trim();
    }

    // Check if this is a guest booking (notes contain guest info)
    if (booking?.notes) {
      const guestMatch = booking.notes.match(/Guest:\s*([^|]+)/);
      if (guestMatch) {
        return guestMatch[1].trim() + ' (Guest)';
      }
    }

    // If player_id is null, it's a guest booking without name
    if (!booking?.player_id) {
      return t('detail.guestBooking');
    }

    return t('detail.unknownPlayer');
  };

  const getPlayerEmail = (): string | null => {
    // Check profile email first
    if (booking?.player?.profile?.email) {
      return booking.player.profile.email;
    }

    // Check notes for guest email
    if (booking?.notes) {
      const emailMatch = booking.notes.match(/Email:\s*([^|]+)/);
      if (emailMatch) {
        return emailMatch[1].trim();
      }
    }

    return null;
  };

  const getCourtName = (): string => {
    if (!booking?.court) return 'Unknown';
    return booking.court.name || `Court ${booking.court.court_number}`;
  };

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const formatPrice = (cents: number | null, currency: string | null): string => {
    if (!cents) return '-';
    const amount = cents / 100;
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: currency || 'CAD',
    }).format(amount);
  };

  const formatDateTime = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const getDuration = (): string => {
    if (!booking) return '-';
    const start = booking.start_time.split(':').map(Number);
    const end = booking.end_time.split(':').map(Number);
    const startMinutes = start[0] * 60 + start[1];
    const endMinutes = end[0] * 60 + end[1];
    const durationMinutes = endMinutes - startMinutes;
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    if (hours === 0) return `${minutes}min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}min`;
  };

  const getStatusBadgeVariant = (
    status: string
  ): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'confirmed':
        return 'default';
      case 'completed':
        return 'secondary';
      case 'cancelled':
        return 'destructive';
      case 'no_show':
        return 'destructive';
      case 'pending':
      case 'awaiting_approval':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const handleCancelBooking = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason }),
      });

      if (!response.ok) {
        throw new Error('Failed to cancel booking');
      }

      await fetchBooking();
      setCancelDialog(false);
      setCancelReason('');
    } catch (err) {
      console.error('Error cancelling booking:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkNoShow = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'no_show' }),
      });

      if (!response.ok) {
        throw new Error('Failed to update booking');
      }

      await fetchBooking();
      setNoShowDialog(false);
    } catch (err) {
      console.error('Error updating booking:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkComplete = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });

      if (!response.ok) {
        throw new Error('Failed to update booking');
      }

      await fetchBooking();
      setCompleteDialog(false);
    } catch (err) {
      console.error('Error updating booking:', err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-muted-foreground mb-4">{error || 'Booking not found'}</p>
        <BackButton asButton variant="outline">
          {t('detail.backToList')}
        </BackButton>
      </div>
    );
  }

  const canCancel = booking.status === 'confirmed' || booking.status === 'pending';
  const canMarkComplete = booking.status === 'confirmed';
  const canMarkNoShow = booking.status === 'confirmed';

  return (
    <div className="flex flex-col w-full gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton className="p-2 hover:bg-muted rounded-md transition-colors" />
          <div>
            <h1 className="text-3xl font-bold mb-0">{t('detail.title')}</h1>
            <p className="text-muted-foreground mb-0">
              {t('detail.bookingId')}: {booking.id.slice(0, 8)}...
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canMarkComplete && (
            <Button variant="outline" onClick={() => setCompleteDialog(true)}>
              <CheckCircle className="mr-2 size-4" />
              {t('actions.markComplete')}
            </Button>
          )}
          {canMarkNoShow && (
            <Button variant="outline" onClick={() => setNoShowDialog(true)}>
              <UserX className="mr-2 size-4" />
              {t('actions.markNoShow')}
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" onClick={() => setCancelDialog(true)}>
              <XCircle className="mr-2 size-4" />
              {t('actions.cancel')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Booking Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="size-5" />
              {t('detail.bookingInfo')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.status')}</span>
              <Badge variant={getStatusBadgeVariant(booking.status)}>
                {t(`status.${booking.status as BookingStatus}`)}
              </Badge>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.date')}</span>
              <span className="font-medium">
                {new Date(booking.booking_date + 'T00:00:00').toLocaleDateString(locale, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.time')}</span>
              <span className="font-medium">
                {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.duration')}</span>
              <span className="font-medium">{getDuration()}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.court')}</span>
              <span className="font-medium">{getCourtName()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.facility')}</span>
              <span className="font-medium">{booking.court?.facility?.name}</span>
            </div>
          </CardContent>
        </Card>

        {/* Player Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="size-5" />
              {t('detail.playerInfo')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.playerName')}</span>
              <span className="font-medium">{getPlayerName()}</span>
            </div>
            {getPlayerEmail() && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('detail.playerEmail')}</span>
                <span className="font-medium">{getPlayerEmail()}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-5" />
              {t('detail.paymentInfo')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.amount')}</span>
              <span className="font-medium text-lg">
                {formatPrice(booking.price_cents, booking.currency)}
              </span>
            </div>
            {booking.stripe_payment_intent_id && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('detail.stripePaymentId')}</span>
                  <code className="text-sm bg-muted px-2 py-1 rounded">
                    {booking.stripe_payment_intent_id.slice(0, 20)}...
                  </code>
                </div>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <a
                    href={`https://dashboard.stripe.com/payments/${booking.stripe_payment_intent_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    {t('detail.viewInStripe')}
                  </a>
                </Button>
              </>
            )}
            {booking.refund_status && booking.refund_status !== 'none' && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('detail.refundStatus')}</span>
                  <Badge variant="secondary">{booking.refund_status}</Badge>
                </div>
                {booking.refund_amount_cents && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('detail.refundAmount')}</span>
                    <span className="font-medium">
                      {formatPrice(booking.refund_amount_cents, booking.currency)}
                    </span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-5" />
              {t('detail.timeline')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="size-2 rounded-full bg-primary mt-2" />
                <div>
                  <div className="font-medium">{t('detail.createdAt')}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDateTime(booking.created_at)}
                  </div>
                </div>
              </div>
              {booking.status === 'confirmed' && (
                <div className="flex items-start gap-3">
                  <div className="size-2 rounded-full bg-green-500 mt-2" />
                  <div>
                    <div className="font-medium">{t('detail.confirmedAt')}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(booking.updated_at)}
                    </div>
                  </div>
                </div>
              )}
              {booking.cancelled_at && (
                <div className="flex items-start gap-3">
                  <div className="size-2 rounded-full bg-destructive mt-2" />
                  <div>
                    <div className="font-medium">{t('detail.cancelledAt')}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(booking.cancelled_at)}
                    </div>
                    {booking.cancellation_reason && (
                      <div className="mt-1">
                        <span className="text-sm text-muted-foreground">
                          {t('detail.cancellationReason')}:{' '}
                        </span>
                        <span className="text-sm">{booking.cancellation_reason}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="mb-0">{t('cancel.title')}</DialogTitle>
            <DialogDescription className="mb-0">{t('cancel.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">{t('cancel.reasonLabel')}</Label>
              <Textarea
                id="cancel-reason"
                placeholder={t('cancel.reasonPlaceholder')}
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(false)}>
              {t('cancel.cancelButton')}
            </Button>
            <Button variant="destructive" onClick={handleCancelBooking} disabled={actionLoading}>
              {actionLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('cancel.confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No-Show Dialog */}
      <Dialog open={noShowDialog} onOpenChange={setNoShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('noShow.title')}</DialogTitle>
            <DialogDescription>{t('noShow.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoShowDialog(false)}>
              {t('noShow.cancelButton')}
            </Button>
            <Button variant="destructive" onClick={handleMarkNoShow} disabled={actionLoading}>
              {actionLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('noShow.confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Dialog */}
      <Dialog open={completeDialog} onOpenChange={setCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('complete.title')}</DialogTitle>
            <DialogDescription>{t('complete.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialog(false)}>
              {t('complete.cancelButton')}
            </Button>
            <Button onClick={handleMarkComplete} disabled={actionLoading}>
              {actionLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('complete.confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
