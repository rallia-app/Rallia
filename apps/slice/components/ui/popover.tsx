'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

/**
 * Vendored from the parent app's shadcn popover. The design-system tokens and
 * tw-animate-css classes are dropped: the only consumer (LevelGuidePopover)
 * overrides all of them with .smk styling anyway.
 */

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={['z-50 w-72 p-4 outline-none', className].filter(Boolean).join(' ')}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
