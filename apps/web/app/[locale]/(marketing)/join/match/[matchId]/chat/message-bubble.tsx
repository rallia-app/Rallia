'use client';

import type { MessageWithSender } from '@rallia/shared-services';

import { cn } from '@/lib/utils';

function senderName(message: MessageWithSender): string {
  const profile = message.sender?.profile;
  if (!profile) return '';
  return (
    profile.display_name || [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  );
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function MessageAvatar({ message }: { message: MessageWithSender }) {
  const name = senderName(message);
  const picture = message.sender?.profile?.profile_picture_url;

  if (picture) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={picture} alt={name} className="size-8 shrink-0 rounded-full object-cover" />;
  }

  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {initials(name)}
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function MessageBubble({
  message,
  isOwn,
  showSender,
  showTime,
  groupStart,
}: {
  message: MessageWithSender;
  isOwn: boolean;
  showSender: boolean;
  showTime: boolean;
  groupStart: boolean;
}) {
  const isOptimistic = message.id.startsWith('optimistic-');

  return (
    <div
      className={cn(
        'flex w-full gap-2',
        isOwn ? 'justify-end' : 'justify-start',
        groupStart ? 'mt-3' : 'mt-0.5'
      )}
    >
      {!isOwn && (
        <div className="w-8 shrink-0">{showSender && <MessageAvatar message={message} />}</div>
      )}

      <div className={cn('flex max-w-[78%] flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
        {!isOwn && showSender && (
          <span className="px-1 text-xs font-medium text-muted-foreground">
            {senderName(message)}
          </span>
        )}
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap',
            isOwn
              ? 'rounded-br-md bg-primary text-primary-foreground'
              : 'rounded-bl-md bg-muted text-foreground',
            isOptimistic && 'opacity-70'
          )}
        >
          {message.content}
        </div>
        {showTime && (
          <span className="px-1 text-[10px] text-muted-foreground">
            {formatTime(message.created_at)}
          </span>
        )}
      </div>
    </div>
  );
}
