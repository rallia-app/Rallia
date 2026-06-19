'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { MessageWithSender } from '@rallia/shared-services';

import { Button } from '@/components/ui/button';

import { MessageBubble } from './message-bubble';

/** Two timestamps fall in the same clock minute. */
function sameMinute(a: string, b: string): boolean {
  return Math.floor(new Date(a).getTime() / 60000) === Math.floor(new Date(b).getTime() / 60000);
}

export function MessageList({
  messages,
  currentPlayerId,
  emptyLabel,
  loadEarlierLabel,
  hasMore,
  isFetchingMore,
  onLoadEarlier,
}: {
  messages: MessageWithSender[];
  currentPlayerId: string;
  emptyLabel: string;
  loadEarlierLabel: string;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadEarlier: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  // Keep the newest message in view by scrolling ONLY this container — never the
  // window. scrollIntoView() bubbles to scrollable ancestors (incl. the page),
  // which made the whole screen jump on send.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [lastId]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
      {hasMore && (
        <div className="flex justify-center pb-1">
          <Button variant="ghost" size="sm" onClick={onLoadEarlier} disabled={isFetchingMore}>
            {isFetchingMore && <Loader2 className="size-4 animate-spin" />}
            {loadEarlierLabel}
          </Button>
        </div>
      )}

      {messages.map((message, index) => {
        const isOwn = message.sender_id === currentPlayerId;
        const prev = messages[index - 1];
        const next = messages[index + 1];
        // A group = consecutive messages from the same sender within the same minute.
        const groupedWithPrev =
          !!prev &&
          prev.sender_id === message.sender_id &&
          sameMinute(prev.created_at, message.created_at);
        const groupedWithNext =
          !!next &&
          next.sender_id === message.sender_id &&
          sameMinute(next.created_at, message.created_at);
        return (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={isOwn}
            showSender={!isOwn && !groupedWithPrev}
            showTime={!groupedWithNext}
            groupStart={!groupedWithPrev}
          />
        );
      })}
    </div>
  );
}
