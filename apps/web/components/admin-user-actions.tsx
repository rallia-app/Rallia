'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateBanDialog } from '@/components/create-ban-dialog';
import { useRouter } from '@/i18n/navigation';
import { useBans } from '@rallia/shared-hooks';
import { Ban, Loader2, ShieldBan, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface AdminUserActionsProps {
  userId: string;
  userName: string;
  currentStatus: string;
}

export function AdminUserActions({ userId, userName, currentStatus }: AdminUserActionsProps) {
  const t = useTranslations('admin.users.detail.actions');
  const router = useRouter();
  const { createBan } = useBans({ autoFetch: false });

  const [confirmAction, setConfirmAction] = useState<'suspend' | 'reactivate' | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showBanDialog, setShowBanDialog] = useState(false);

  const handleExecute = async () => {
    if (!confirmAction) return;
    setIsExecuting(true);
    try {
      const response = await fetch('/api/admin/players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerIds: [userId], action: confirmAction }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${confirmAction} player`);
      }
      setConfirmAction(null);
      router.refresh();
    } catch (error) {
      console.error('Action error:', error);
      alert(error instanceof Error ? error.message : t('error'));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {currentStatus === 'active' && (
          <Button variant="destructive" size="sm" onClick={() => setConfirmAction('suspend')}>
            <Ban className="h-4 w-4 mr-2" />
            {t('suspend')}
          </Button>
        )}
        {currentStatus === 'suspended' && (
          <Button variant="default" size="sm" onClick={() => setConfirmAction('reactivate')}>
            <UserCheck className="h-4 w-4 mr-2" />
            {t('reactivate')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowBanDialog(true)}>
          <ShieldBan className="h-4 w-4 mr-2" />
          {t('ban')}
        </Button>
      </div>

      {/* Suspend / Reactivate confirmation */}
      <Dialog open={!!confirmAction} onOpenChange={open => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction === 'suspend' ? t('suspendConfirmTitle') : t('reactivateConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === 'suspend'
                ? t('suspendConfirmDescription', { name: userName })
                : t('reactivateConfirmDescription', { name: userName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={isExecuting}>
              {t('cancel')}
            </Button>
            <Button
              variant={confirmAction === 'suspend' ? 'destructive' : 'default'}
              onClick={handleExecute}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {confirmAction === 'suspend' ? t('suspending') : t('reactivating')}
                </>
              ) : (
                t('confirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban dialog */}
      <CreateBanDialog
        open={showBanDialog}
        onClose={() => setShowBanDialog(false)}
        onCreateBan={async params => {
          const result = await createBan(params);
          if (result) router.refresh();
          return result;
        }}
        initialPlayerId={userId}
      />
    </>
  );
}
