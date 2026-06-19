'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useAgreeToChatRules,
  useChatAgreement,
  useChatRealtime,
  useConversation,
  useMarkMessagesAsRead,
  useMessages,
  useSendMessage,
} from '@rallia/shared-hooks';
import { getMatchChat, supabase, type MessageWithSender } from '@rallia/shared-services';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { ChatRulesGate } from './chat-rules-gate';
import { MessageComposer } from './message-composer';
import { MessageList } from './message-list';

export function MatchChat({ matchId }: { matchId: string }) {
  const t = useTranslations('webJoin');
  const backHref = `/join/match/${matchId}`;

  // --- current user -------------------------------------------------------
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active) return;
        setPlayerId(data.user?.id ?? null);
        setAuthResolved(true);
      })
      .catch(() => {
        if (active) setAuthResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // --- match conversation (created server-side by triggers when a player joins)
  const { data: conversation, isLoading: convLoading } = useQuery({
    queryKey: ['web-match-chat', matchId],
    queryFn: () => getMatchChat(matchId),
    enabled: !!playerId,
  });
  const conversationId = conversation?.id;

  const { data: conversationDetails } = useConversation(conversationId);
  const participantCount = conversationDetails?.participants?.length ?? 0;

  // --- messages -----------------------------------------------------------
  const {
    data: messagesData,
    isLoading: msgsLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useMessages(conversationId);

  // getMessages returns newest-first; reverse for top-to-bottom chronological display.
  const messages = useMemo<MessageWithSender[]>(
    () => (messagesData?.pages.flat() ?? []).slice().reverse(),
    [messagesData]
  );

  const sendMessage = useSendMessage();
  const markRead = useMarkMessagesAsRead();

  // Mark read on open and whenever a new message arrives.
  useEffect(() => {
    if (conversationId && playerId) markRead.mutate({ conversationId, playerId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, playerId]);

  useChatRealtime(conversationId, playerId ?? undefined, {
    onNewMessage: () => {
      if (conversationId && playerId) markRead.mutate({ conversationId, playerId });
    },
  });

  // --- chat rules agreement (UI/safety gate, parity with mobile) ----------
  const { data: hasAgreed } = useChatAgreement(playerId ?? undefined);
  const agree = useAgreeToChatRules();

  const handleSend = useCallback(
    (content: string) => {
      if (!conversationId || !playerId) return;
      sendMessage.mutate({ conversation_id: conversationId, sender_id: playerId, content });
    },
    [conversationId, playerId, sendMessage]
  );

  const isLoading =
    !authResolved || (!!playerId && (convLoading || (!!conversationId && msgsLoading)));

  return (
    <div className="mx-auto flex h-[70vh] min-h-[480px] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Button asChild variant="ghost" size="icon" className="size-8 shrink-0">
          <Link href={backHref} aria-label={t('chat.back')}>
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <h1 className="mb-0 min-w-0 flex-1 truncate text-base font-bold leading-tight">
          {conversationDetails?.title || t('chat.title')}
        </h1>
        {participantCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {t('chat.subtitle', { count: participantCount })}
          </span>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !playerId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">{t('chat.signInPrompt')}</p>
          <Button asChild size="lg" className="font-semibold">
            <Link href={backHref}>{t('chat.signInCta')}</Link>
          </Button>
        </div>
      ) : !conversationId ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">{t('chat.notReady')}</p>
        </div>
      ) : (
        <MessageList
          messages={messages}
          currentPlayerId={playerId}
          emptyLabel={t('chat.empty')}
          loadEarlierLabel={t('chat.loadEarlier')}
          hasMore={!!hasNextPage}
          isFetchingMore={isFetchingNextPage}
          onLoadEarlier={() => {
            void fetchNextPage();
          }}
        />
      )}

      {/* Footer: rules gate until accepted, then composer */}
      {!!conversationId &&
        !!playerId &&
        (hasAgreed === false ? (
          <ChatRulesGate
            title={t('chat.rules.title')}
            body={t('chat.rules.body')}
            acceptLabel={t('chat.rules.accept')}
            isAccepting={agree.isPending}
            onAccept={() => {
              if (playerId) agree.mutate(playerId);
            }}
          />
        ) : (
          <MessageComposer
            placeholder={t('chat.composerPlaceholder')}
            sendLabel={t('chat.send')}
            disabled={sendMessage.isPending}
            onSend={handleSend}
          />
        ))}
    </div>
  );
}
