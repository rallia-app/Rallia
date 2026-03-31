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
import { useRouter } from '@/i18n/navigation';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export interface BulkActionDef {
  label: string;
  variant: 'destructive' | 'default';
  icon: React.ReactNode;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  loadingLabel: string;
  onExecute: (ids: string[]) => Promise<void>;
}

interface DataTableBulkActionsProps {
  selectedIds: string[];
  selectedMessage: string;
  actions: BulkActionDef[];
  onActionComplete: () => void;
}

export function DataTableBulkActions({
  selectedIds,
  selectedMessage,
  actions,
  onActionComplete,
}: DataTableBulkActionsProps) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<BulkActionDef | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    if (!activeAction) return;
    setIsExecuting(true);
    try {
      await activeAction.onExecute(selectedIds);
      setActiveAction(null);
      onActionComplete();
      router.refresh();
    } catch (error) {
      console.error('Bulk action error:', error);
      alert(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setIsExecuting(false);
    }
  };

  if (selectedIds.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-4 p-4 bg-muted/50 border-b">
        <span className="text-sm font-medium">{selectedMessage}</span>
        {actions.map((action, i) => (
          <Button
            key={i}
            variant={action.variant}
            size="sm"
            onClick={() => setActiveAction(action)}
            disabled={isExecuting}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
      </div>

      <Dialog open={!!activeAction} onOpenChange={open => !open && setActiveAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeAction?.confirmTitle}</DialogTitle>
            <DialogDescription>{activeAction?.confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveAction(null)} disabled={isExecuting}>
              Cancel
            </Button>
            <Button
              variant={activeAction?.variant ?? 'destructive'}
              onClick={handleExecute}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {activeAction?.loadingLabel}
                </>
              ) : (
                activeAction?.confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
