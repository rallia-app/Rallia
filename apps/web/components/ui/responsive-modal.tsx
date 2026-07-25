'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

export type ResponsiveModalSize = 'sm' | 'md' | 'lg' | 'full';

const DIALOG_SIZE_CLASSES: Record<ResponsiveModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  full: 'sm:max-w-4xl',
};

interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: ResponsiveModalSize;
  /**
   * Required. Radix warns when a Dialog has no title, and a screen reader needs one
   * regardless — pass `titleHidden` when the design does not show it.
   */
  title: string;
  description?: string;
  titleHidden?: boolean;
  /** Blocks outside-click and Escape. For destructive confirmations and paid flows. */
  dismissible?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * One overlay primitive that renders a centred Dialog at md and up and a bottom Drawer
 * below it — the web counterpart to mobile's action sheets.
 *
 * Both branches expose the same header/body/footer structure, so an overlay author
 * writes the body once and never branches on viewport.
 */
export function ResponsiveModal({
  open,
  onOpenChange,
  size = 'md',
  title,
  description,
  titleHidden = false,
  dismissible = true,
  children,
  footer,
  className,
}: ResponsiveModalProps) {
  const isDesktop = useIsDesktop();

  const blockDismiss = dismissible
    ? undefined
    : (event: Event) => {
        event.preventDefault();
      };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(DIALOG_SIZE_CLASSES[size], className)}
          showCloseButton={dismissible}
          onInteractOutside={blockDismiss}
          onEscapeKeyDown={blockDismiss}
        >
          <DialogHeader className={titleHidden ? 'sr-only' : undefined}>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          {footer && <DialogFooter>{footer}</DialogFooter>}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={dismissible}>
      <DrawerContent
        className={className}
        onInteractOutside={blockDismiss}
        onEscapeKeyDown={blockDismiss}
      >
        {/* Drawer content scrolls independently; the tall sheets (availability grid,
            player picker) would otherwise push the handle off screen. */}
        <div className="max-h-[80vh] overflow-y-auto">
          <DrawerHeader className={titleHidden ? 'sr-only' : 'text-left'}>
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <div className="px-4 pb-4">{children}</div>
        </div>
        {footer && <DrawerFooter className="pt-2">{footer}</DrawerFooter>}
      </DrawerContent>
    </Drawer>
  );
}
