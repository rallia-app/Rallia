/**
 * TournamentDetail Screen
 *
 * Read-only summary plus organizer/registrant action affordances.
 *
 * V1: hero, format/schedule/visibility cards, "Coming soon" placeholder.
 * V2: open/close registration (organizer), self-register/withdraw
 *     (registrant), registrations count.
 *
 * Spec: specs/17-leagues-tournaments/rollout.md §V1, §V2
 */

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Platform,
  Pressable,
  TextInput,
  Image,
  Alert,
  RefreshControl,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { SheetManager } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Text, useToast } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  primary,
  accent,
  neutral,
  secondary,
  status,
} from '@rallia/design-system';
import { useStripe } from '@stripe/stripe-react-native';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getHumanName,
  getInitialName,
  getProfilePictureUrl,
  formatPrice,
  tournamentRankingHeadline,
  tournamentPointsLadder,
} from '@rallia/shared-utils';
import {
  useTheme,
  useTournament,
  useTournamentRegistrations,
  useMyTournamentRegistration,
  useRegistrationReceiptUrl,
  useTournamentFeeQuote,
  useParticipationTerms,
  useMyPayoutAccount,
  useEventEarnings,
  useCreateRegistrationPayment,
  useRefundRegistration,
  useOpenTournamentRegistration,
  useCloseTournamentRegistration,
  useReopenTournamentRegistration,
  useRegisterForTournament,
  useAcceptTournamentInvite,
  useRevokeTournamentInvite,
  useWithdrawFromTournament,
  useRemoveTournamentRegistration,
  useForfeitTournamentRegistration,
  useApproveTournamentRegistration,
  useTournamentInvitePreview,
  useJoinTournamentViaInvite,
  useTournamentMatches,
  useTournamentPoolStandings,
  useGenerateTournamentKnockout,
  useTournamentRoundDeadlines,
  useOpenTournamentRoundChat,
  useIsTournamentOrganizer,
  useIsCertifiedOrganizer,
  useCancelTournament,
  useArchiveTournament,
  useUnarchiveTournament,
  useProfilesByIds,
  useTournamentParticipants,
  useSports,
  useAuth,
  tournamentKeys,
} from '@rallia/shared-hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { Enums, Tables } from '@rallia/shared-types';
import * as WebBrowser from 'expo-web-browser';
import {
  getTournamentChat,
  getMyPayoutAccount,
  TournamentPaymentError,
  supabase,
} from '@rallia/shared-services';
import type { PlayerSearchResult } from '@rallia/shared-services';

import { useTranslation, useRequireOnboarding, type TranslationKey } from '../hooks';
import * as Analytics from '../services/analytics';
import { useActionsSheet } from '../context';
import { ConfirmationModal } from '../components/ConfirmationModal';
import UnderlineTabBar, { type UnderlineTabItem } from '../components/UnderlineTabBar';
import { EventDetailTabBar } from '../features/events/components/EventDetailChrome';
import { styles } from '../features/tournaments/detail/detailStyles';
import { BracketTab } from '../features/tournaments/detail/BracketTab';
import { OverviewTab } from '../features/tournaments/detail/OverviewTab';
import { roundLabel } from '../features/tournaments/detail/BracketSection';
import { DetailsTab } from '../features/tournaments/detail/DetailsTab';
import { PlayersTab } from '../features/tournaments/detail/PlayersTab';
import { RulesTab } from '../features/tournaments/detail/RulesTab';
import {
  BRACKET_TYPE_LABEL_KEY,
  DashboardCtaCard,
  ENTRY_FORMAT_LABEL_KEY,
  HeroChip,
  InfoRow,
  InvitedSection,
  LabeledBlock,
  LifecycleStepper,
  LiveBadge,
  MATCH_FORMAT_LABEL_KEY,
  OverviewActionRow,
  OverviewInfoRow,
  PAID_REGISTER_ERROR_KEYS,
  ParticipantsSection,
  PendingRequestsSection,
  PointsTab,
  REG_MODE_LABEL_KEY,
  Section,
  StackedRow,
  StatSegment,
  StatusBadge,
  TournamentDetailSkeleton,
  VISIBILITY_LABEL_KEY,
  formatRatingRange,
  refundPolicyLine,
  seedFallbackLabel,
} from '../features/tournaments/detail/components';
import type {
  PendingRequestRow,
  PlayersSegment,
  ScreenColors,
  TabKey,
} from '../features/tournaments/detail/components';
import { poolPreviewText } from '../features/tournaments/poolPreview';
import { prizeAmountLabel } from '../features/tournaments/prizeLabel';
import { ChampionCard } from '../features/tournaments/components/ChampionCard';
import { PoolsSection, poolsComplete } from '../features/tournaments/components/PoolsSection';
import { TournamentBanner } from '../features/tournaments/components/TournamentBanner';
import type { RootStackParamList } from '../navigation';

type TournamentDetailRoute = RouteProp<RootStackParamList, 'TournamentDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const TournamentDetail: React.FC = () => {
  const { params } = useRoute<TournamentDetailRoute>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const isDark = theme === 'dark';
  const userId = session?.user?.id;
  // The page reads for everyone, signed out included; the actions that change
  // state route through here first and open auth/onboarding when needed.
  const { guardAction } = useRequireOnboarding();

  const {
    data: directTournament,
    isLoading,
    isError,
    refetch,
  } = useTournament(params.tournamentId);
  const { data: registrations = [] } = useTournamentRegistrations(params.tournamentId);
  const { data: myRegistration } = useMyTournamentRegistration(params.tournamentId, userId);
  const { sports } = useSports();
  const { openSheetForTournamentEdit } = useActionsSheet();

  // Invite-token fallback: when the direct fetch comes back empty (private
  // tournament, caller not yet registered → RLS hides the row), a valid
  // token still renders the page via the preview RPC.
  const invitePreviewEnabled = !!params.inviteToken && !isLoading && !directTournament;
  const {
    data: invitePreview,
    isLoading: invitePreviewLoading,
    isError: inviteInvalid,
  } = useTournamentInvitePreview(params.inviteToken, invitePreviewEnabled);
  const tournament = directTournament ?? invitePreview?.tournament ?? null;

  const isPrimaryOrganizer = !!tournament && !!userId && tournament.organizer_id === userId;
  // Co-organizers share full organizer rights; resolved server-side. OR with the
  // sync primary check so the owner sees controls immediately (no query flicker).
  const { data: amIOrganizer } = useIsTournamentOrganizer(tournament?.id);
  const isOrganizer = isPrimaryOrganizer || !!amIOrganizer;
  // Only a certified organizer's tournament awards Circuit Rallia points.
  const { data: organizerIsCertified } = useIsCertifiedOrganizer(tournament?.organizer_id);
  const awardsRankingPoints = !!organizerIsCertified;
  const canManageCoOrganizers =
    isPrimaryOrganizer &&
    !!tournament &&
    tournament.status !== 'completed' &&
    tournament.status !== 'cancelled' &&
    tournament.status !== 'archived';
  const myActiveRegistration =
    myRegistration &&
    (myRegistration.status === 'registered' || myRegistration.status === 'pending')
      ? myRegistration
      : null;

  // Tournament chat (trigger-managed conversation). RLS only returns it to
  // participants, so an existing id doubles as the access check.
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const isChatMember = isOrganizer || myRegistration?.status === 'registered';
  useEffect(() => {
    let isMounted = true;
    if (!userId || !isChatMember) {
      setChatConversationId(null);
      return;
    }
    getTournamentChat(params.tournamentId).then(conversation => {
      if (isMounted) setChatConversationId(conversation?.id ?? null);
    });
    return () => {
      isMounted = false;
    };
  }, [params.tournamentId, userId, isChatMember]);

  const handleOpenChat = useCallback(() => {
    if (!chatConversationId || !tournament) return;
    lightHaptic();
    navigation.navigate('ChatConversation', {
      conversationId: chatConversationId,
      title: tournament.name,
    });
  }, [chatConversationId, tournament, navigation]);
  // RLS hides other players' registrations on private tournaments, so the
  // token preview supplies the count until the caller registers.
  //
  // activeCount = registered + pending (self-requests AND unaccepted invites).
  // It reflects reserved capacity, so it drives spotsLeft — the DB counts the
  // same set against max_participants, and showing pending slots as "free"
  // would let the register CTA offer spots the RPC then rejects.
  const activeCount = directTournament ? registrations.length : (invitePreview?.activeCount ?? 0);
  // registeredCount = confirmed entries only. Pending rows (approval requests
  // and unaccepted organizer invites) are neither in the Confirmed tab nor the
  // bracket, so they must not inflate any "registered / players in" display.
  // The private-tournament viewer can't see the breakdown; fall back to active.
  const registeredCount = directTournament
    ? registrations.filter(r => r.status === 'registered').length
    : (invitePreview?.activeCount ?? 0);

  const showError = useCallback(
    (errMsg: string, fallbackKey: TranslationKey) => {
      const lower = errMsg.toLowerCase();
      // Partner codes come first: partner_already_registered and
      // partner_sport_mismatch contain the bare codes as substrings.
      // paid_use_refund means the caller reached tournament_withdraw with a paid
      // entry. The UI routes those to the refund flow, so this is a safety net.
      const key: TranslationKey = lower.includes('paid_use_refund')
        ? 'tournamentDetail.errors.paidUseRefund'
        : lower.includes('partner_already_registered')
          ? 'tournamentDetail.errors.partnerAlreadyRegistered'
          : lower.includes('partner_sport_mismatch')
            ? 'tournamentDetail.errors.partnerSportMismatch'
            : lower.includes('partner_required')
              ? 'tournamentDetail.errors.partnerRequired'
              : lower.includes('partner_invalid') || lower.includes('partner_not_allowed')
                ? 'tournamentDetail.errors.partnerInvalid'
                : lower.includes('invite_invalid')
                  ? 'tournamentDetail.errors.inviteInvalid'
                  : lower.includes('sport_mismatch')
                    ? 'tournamentDetail.errors.sportMismatch'
                    : lower.includes('tournament_full')
                      ? 'tournamentDetail.errors.tournamentFull'
                      : lower.includes('already_registered')
                        ? 'tournamentDetail.errors.alreadyRegistered'
                        : lower.includes('not_invited')
                          ? 'tournamentDetail.errors.notInvited'
                          : lower.includes('optimistic_lock')
                            ? 'tournamentDetail.errors.lockConflict'
                            : lower.includes('start_passed')
                              ? 'tournamentDetail.errors.startPassed'
                              : lower.includes('withdraw_not_allowed')
                                ? 'tournamentDetail.errors.withdrawClosed'
                                : lower.includes('registration_removed')
                                  ? 'tournamentDetail.errors.registrationRemoved'
                                  : lower.includes('approve_not_allowed')
                                    ? 'tournamentDetail.errors.approveNotAllowed'
                                    : lower.includes('remove_not_allowed')
                                      ? 'tournamentDetail.errors.removeNotAllowed'
                                      : lower.includes('forfeit_not_allowed')
                                        ? 'tournamentDetail.errors.forfeitNotAllowed'
                                        : lower.includes('registration_not_found')
                                          ? 'tournamentDetail.errors.lockConflict'
                                          : lower.includes('tournament_reg_closed') ||
                                              lower.includes('reg_closed')
                                            ? 'tournamentDetail.errors.regClosed'
                                            : // partner_rating_* first: they contain the bare rating_* codes.
                                              lower.includes('partner_rating_too_low')
                                              ? 'tournamentDetail.errors.partnerRatingTooLow'
                                              : lower.includes('partner_rating_too_high')
                                                ? 'tournamentDetail.errors.partnerRatingTooHigh'
                                                : lower.includes('partner_rating_recently_higher')
                                                  ? 'tournamentDetail.errors.partnerRatingRecentlyHigher'
                                                  : lower.includes('partner_rating_required')
                                                    ? 'tournamentDetail.errors.partnerRatingRequired'
                                                    : lower.includes('rating_too_low')
                                                      ? 'tournamentDetail.errors.ratingTooLow'
                                                      : lower.includes('rating_too_high')
                                                        ? 'tournamentDetail.errors.ratingTooHigh'
                                                        : lower.includes('rating_recently_higher')
                                                          ? 'tournamentDetail.errors.ratingRecentlyHigher'
                                                          : lower.includes('rating_required')
                                                            ? 'tournamentDetail.errors.ratingRequired'
                                                            : fallbackKey;
      warningHaptic();
      toast.error(t(key));
    },
    [t, toast]
  );

  const queryClient = useQueryClient();

  // Organizer payout onboarding: a card-capable Stripe Express account (manual
  // payouts) that becomes the settlement merchant for paid registrations.
  // Organizers must finish this before a paid event can open.
  const handleStripeOnboard = useCallback(
    async (businessType: 'individual' | 'company') => {
      try {
        const { data, error } = await supabase.functions.invoke('player-stripe-onboard', {
          body: { businessType },
        });
        if (error || !data?.url) throw new Error(error?.message);
        // The return URL must be the app's custom scheme, not an https URL:
        // ASWebAuthenticationSession only auto-dismisses on a custom-scheme
        // callback. Stripe's https return_url bounces to this scheme via the
        // web /stripe-connect-return page, which closes the modal.
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          'rallia://stripe-connect-return'
        );
        if (result.type === 'success' && userId) {
          // stripe-connect-webhook flips the mirror asynchronously (usually
          // well under 30 s); poll it so the payout badge updates without the
          // user leaving and reopening the screen.
          successHaptic();
          toast.info(t('tournamentDetail.payments.payoutSyncWait'));
          void (async () => {
            for (let attempt = 0; attempt < 10; attempt++) {
              const status = await queryClient
                .fetchQuery({
                  queryKey: tournamentKeys.myPayoutAccount(userId),
                  queryFn: getMyPayoutAccount,
                  staleTime: 0,
                })
                .catch(() => null);
              if (status?.chargesEnabled) {
                successHaptic();
                toast.success(t('tournamentDetail.payments.payoutsConnectedToast'));
                return;
              }
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          })();
        }
      } catch {
        warningHaptic();
        toast.error(t('tournamentDetail.payments.onboardingError'));
      }
    },
    [toast, t, userId, queryClient]
  );

  // Ask individual vs company, then kick off onboarding. Shared by the
  // registration-guard error path and the payout card.
  const promptOnboardPayouts = useCallback(() => {
    Alert.alert(
      t('tournamentDetail.payments.payoutsSetupTitle'),
      t('tournamentDetail.payments.payoutsSetupBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('tournamentDetail.payments.onboardTypeIndividual'),
          onPress: () => void handleStripeOnboard('individual'),
        },
        {
          text: t('tournamentDetail.payments.onboardTypeBusiness'),
          onPress: () => void handleStripeOnboard('company'),
        },
      ]
    );
  }, [t, handleStripeOnboard]);

  // The moment a player gets in is the moment to bring friends: when their
  // share link is mintable (same conditions as canPlayerShare below), success
  // toasts carry an invite action that opens the share sheet.
  const inviteNudgeAction = useCallback(() => {
    if (
      !tournament ||
      isOrganizer ||
      tournament.visibility !== 'public' ||
      tournament.status !== 'registration_open' ||
      tournament.registration_mode === 'invite_only'
    ) {
      return {};
    }
    const { id: tournamentId, name: tournamentName } = tournament;
    return {
      actionText: t('tournamentDetail.invite.shareCta'),
      duration: 6000,
      onAction: () => {
        void SheetManager.show('tournament-invite', {
          payload: { tournamentId, tournamentName },
        });
      },
    };
  }, [tournament, isOrganizer, t]);

  const open = useOpenTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => {
      // Paid event without completed payout setup. The gate checks the primary
      // organizer's account, so only they get sent to onboarding.
      if (e.message.includes('PAYOUTS_SETUP_REQUIRED')) {
        warningHaptic();
        if (isPrimaryOrganizer) {
          promptOnboardPayouts();
        } else {
          Alert.alert(
            t('tournamentDetail.payments.payoutsSetupTitle'),
            t('tournamentDetail.payments.errors.organizerNotReady')
          );
        }
        return;
      }
      showError(e.message, 'tournamentDetail.errors.openFailed');
    },
  });
  const close = useCloseTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.closeFailed'),
  });
  const reopen = useReopenTournamentRegistration({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.reopenFailed'),
  });
  const register = useRegisterForTournament({
    onSuccess: r => {
      successHaptic();
      toast.success(
        t(
          r.status === 'pending'
            ? 'tournamentDetail.registerToast.pending'
            : 'tournamentDetail.registerToast.registered'
        ),
        inviteNudgeAction()
      );
    },
    onError: e => showError(e.message, 'tournamentDetail.errors.registerFailed'),
  });
  const joinViaInvite = useJoinTournamentViaInvite({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.inviteLanding.joinedToast'), inviteNudgeAction());
      Analytics.tournamentInviteRedeemed({
        tournamentId: params.tournamentId,
        result: 'registered',
      });
    },
    onError: e => {
      Analytics.tournamentInviteRedeemed({
        tournamentId: params.tournamentId,
        result: 'error',
        errorCode: e.message,
      });
      showError(e.message, 'tournamentDetail.errors.registerFailed');
    },
  });
  const registerPending = register.isPending || joinViaInvite.isPending;

  // Paid-registration flow (Stripe PaymentSheet). isPaidTournament gates the
  // price display + the payment branch in onRegister.
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const isPaidTournament = (tournament?.entry_fee_cents ?? 0) > 0;
  const { data: feeQuote } = useTournamentFeeQuote(params.tournamentId, isPaidTournament);
  // Only paid entry needs the consent tick, so only fetch the terms there.
  const { data: participationTerms } = useParticipationTerms(isPaidTournament);
  // Payout status drives the manage/onboard card. Primary only: the entry
  // settles into their connected account, never a co-organizer's.
  const { data: payoutAccount } = useMyPayoutAccount(
    userId,
    isPrimaryOrganizer && isPaidTournament
  );
  // What this event has collected — the organizer's only in-app money view
  // (the Stripe dashboard is account-wide and can't be tied back to one event).
  // lt_event_earnings refuses co-organizers, so gate on the primary.
  const { data: earnings } = useEventEarnings(
    { tournamentId: params.tournamentId },
    isPrimaryOrganizer && isPaidTournament
  );
  // Stripe-hosted receipt for the payer's own paid registration. Not gated on
  // status: after a withdrawal that same receipt is where the refund shows up.
  const { data: receiptUrl } = useRegistrationReceiptUrl(
    myRegistration?.id,
    isPaidTournament && myRegistration?.user_id === userId
  );

  // Post-onboarding management: opens the Stripe Express dashboard (update bank
  // details, view payouts) when ready, or resumes onboarding when unfinished.
  // The webhook refreshes account status, so invalidate on return.
  // player-stripe-manage makes several sequential Stripe calls before returning
  // the link, so the row shows a transient state and blocks re-taps meanwhile.
  const [isOpeningPayoutDashboard, setIsOpeningPayoutDashboard] = useState(false);
  const handleManagePayouts = useCallback(async () => {
    if (isOpeningPayoutDashboard) return;
    setIsOpeningPayoutDashboard(true);
    try {
      const { data, error } = await supabase.functions.invoke('player-stripe-manage');
      if (error || !data?.url) throw new Error(error?.message);
      // Custom scheme (not https) so the auth session dismisses on return — see
      // handleStripeOnboard.
      await WebBrowser.openAuthSessionAsync(data.url, 'rallia://stripe-connect-return');
      if (userId) {
        void queryClient.invalidateQueries({ queryKey: tournamentKeys.myPayoutAccount(userId) });
      }
    } catch {
      warningHaptic();
      toast.error(t('tournamentDetail.payments.manageError'));
    }
    setIsOpeningPayoutDashboard(false);
  }, [toast, t, userId, queryClient, isOpeningPayoutDashboard]);

  // Money summary for this event, from the payment ledger. Alert keeps it
  // glanceable; the Stripe dashboard (payout row) remains the detailed view.
  const showEarnings = useCallback(() => {
    if (!earnings) return;
    const cur = earnings.currency ?? 'CAD';
    const money = (cents: number) => formatPrice(cents, cur, { locale });
    const lines =
      earnings.paidCount === 0 && earnings.pendingCount === 0 && earnings.refundedCount === 0
        ? [t('tournamentDetail.earnings.none')]
        : [
            t('tournamentDetail.earnings.paidLine')
              .replace('{count}', String(earnings.paidCount))
              .replace('{amount}', money(earnings.entryCents)),
            t('tournamentDetail.earnings.feesLine').replace(
              '{amount}',
              money(earnings.serviceFeeCents + earnings.feeTaxCents)
            ),
            ...(earnings.refundedCents > 0
              ? [
                  t('tournamentDetail.earnings.refundedLine').replace(
                    '{amount}',
                    money(earnings.refundedCents)
                  ),
                ]
              : []),
            ...(earnings.pendingCount > 0
              ? [
                  t('tournamentDetail.earnings.pendingLine').replace(
                    '{count}',
                    String(earnings.pendingCount)
                  ),
                ]
              : []),
            t('tournamentDetail.earnings.netLine').replace(
              '{amount}',
              money(earnings.netToOrganizerCents)
            ),
            ...(earnings.releasedCount > 0
              ? [
                  t('tournamentDetail.earnings.releasedLine').replace(
                    '{count}',
                    String(earnings.releasedCount)
                  ),
                ]
              : []),
          ];
    Alert.alert(t('tournamentDetail.earnings.title'), lines.join('\n'), [
      { text: t('tournamentDetail.earnings.close') },
    ]);
  }, [earnings, t, locale]);

  const createRegistrationPayment = useCreateRegistrationPayment();

  const handlePaidRegister = useCallback(
    async (partnerId?: string) => {
      if (!tournament) return;

      // The actual charge — only runs after the player accepts the disclosure
      // and, on a paid entry, ticks the participation-terms consent. The
      // accepted version rides along so the server stamps it on the row.
      const runPayment = async (termsVersion?: number) => {
        try {
          const intent = await createRegistrationPayment.mutateAsync({
            tournamentId: tournament.id,
            partnerId,
            termsVersion,
          });
          // Fully covered by referral credit: the edge function already
          // finalized the registration — no Stripe sheet to present.
          if (!intent.fullyCovered) {
            const { error: initError } = await initPaymentSheet({
              paymentIntentClientSecret: intent.clientSecret as string,
              merchantDisplayName: 'Rallia',
              applePay: { merchantCountryCode: 'CA' },
              googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: __DEV__ },
            });
            if (initError) throw new Error(initError.message);
            const { error: paymentError } = await presentPaymentSheet();
            if (paymentError) {
              if (paymentError.code === 'Canceled') return; // user backed out — slot reaper frees it
              throw new Error(paymentError.message);
            }
          }
          successHaptic();
          toast.success(t('tournamentDetail.payments.successToast'), inviteNudgeAction());
          // The webhook flips payment_pending → registered; refetch now and again
          // shortly after to catch the async finalize.
          const invalidate = () => {
            void queryClient.invalidateQueries({ queryKey: tournamentKeys.detail(tournament.id) });
            void queryClient.invalidateQueries({
              queryKey: tournamentKeys.registrations(tournament.id),
            });
            void queryClient.invalidateQueries({
              queryKey: tournamentKeys.participants(tournament.id),
            });
            void queryClient.invalidateQueries({
              queryKey: tournamentKeys.myRegistration(tournament.id, userId ?? ''),
            });
            void queryClient.invalidateQueries({
              queryKey: tournamentKeys.myActiveRegistrations(userId ?? ''),
            });
            // Paying takes a slot, so the card's count chip moves too.
            void queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() });
          };
          invalidate();
          setTimeout(invalidate, 2500);
        } catch (e) {
          warningHaptic();
          const code = e instanceof TournamentPaymentError ? e.code : undefined;
          const key = code
            ? (PAID_REGISTER_ERROR_KEYS[code] ?? 'tournamentDetail.payments.errors.generic')
            : 'tournamentDetail.payments.errors.generic';
          toast.error(t(key as TranslationKey));
        }
      };

      // Point-of-sale disclosure before any charge: the full price breakdown,
      // the refund policy, that the service fee isn't refundable, and that
      // Rallia only facilitates (the organizer, not Rallia, owns the event).
      // GST/QST rides on Rallia's service fee; the player only pays the fee and
      // its tax in player_pays mode (organizer_absorbs nets them from the
      // organizer's take, so the player sees the entry price and nothing else).
      const money = (cents: number) =>
        feeQuote ? formatPrice(cents, feeQuote.currency, { locale }) : '';
      const playerPaysFee = !!feeQuote && feeQuote.feePayer === 'player_pays';
      // A fee-waived event (0% override) still bills player_pays, so the fee
      // lines have to key off the amount, not the mode.
      const chargesServiceFee = !!feeQuote && playerPaysFee && feeQuote.serviceFeeCents > 0;
      const creditCents = feeQuote?.creditApplicableCents ?? 0;
      const payableCents = feeQuote ? Math.max(feeQuote.totalCents - creditCents, 0) : 0;
      const creditLine =
        creditCents > 0
          ? t('tournamentDetail.payments.breakdownCredit').replace('{amount}', money(creditCents))
          : null;
      const breakdown = !feeQuote
        ? null
        : playerPaysFee
          ? [
              t('tournamentDetail.payments.breakdownEntry').replace(
                '{amount}',
                money(feeQuote.entryCents)
              ),
              chargesServiceFee
                ? t('tournamentDetail.payments.breakdownServiceFee').replace(
                    '{amount}',
                    money(feeQuote.serviceFeeCents)
                  )
                : null,
              feeQuote.feeTaxCents > 0
                ? t('tournamentDetail.payments.breakdownFeeTax').replace(
                    '{amount}',
                    money(feeQuote.feeTaxCents)
                  )
                : null,
              creditLine,
              t('tournamentDetail.payments.breakdownTotal').replace(
                '{amount}',
                money(payableCents)
              ),
            ]
              .filter(Boolean)
              .join('\n')
          : [
              t('tournamentDetail.payments.breakdownEntry').replace(
                '{amount}',
                money(feeQuote.entryCents)
              ),
              t('tournamentDetail.payments.feeCoveredByOrganizer'),
              creditLine,
              t('tournamentDetail.payments.breakdownTotalTaxesIncluded').replace(
                '{amount}',
                money(payableCents)
              ),
            ]
              .filter(Boolean)
              .join('\n');
      const totalLabel = feeQuote ? money(payableCents) : null;
      const disclosureLines = [
        breakdown,
        refundPolicyLine(feeQuote, t, locale),
        chargesServiceFee ? t('tournamentDetail.payments.confirmFeeNonRefundable') : null,
        t('tournamentDetail.payments.liabilityNotice'),
        // What the entry does NOT buy. Court time is the one cost players
        // reliably assume is included, and the venue row on the detail screen
        // reinforces that assumption, so it is spelled out at the till.
        t('tournamentDetail.goodToKnow.courts'),
      ].filter((l): l is string => !!l);

      // A sheet, not an Alert: the participation-terms tick needs a checkbox
      // and two tappable document links, neither of which an Alert can host.
      void SheetManager.show('paid-entry-confirm', {
        payload: {
          disclosureLines,
          totalLabel,
          terms: participationTerms ?? null,
          onConfirm: termsVersion => {
            void runPayment(termsVersion);
          },
        },
      });
    },
    [
      tournament,
      userId,
      createRegistrationPayment,
      initPaymentSheet,
      presentPaymentSheet,
      queryClient,
      toast,
      t,
      locale,
      feeQuote,
      participationTerms,
      inviteNudgeAction,
    ]
  );

  const withdraw = useWithdrawFromTournament({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.withdrawFailed'),
  });
  const refundRegistration = useRefundRegistration({
    onSuccess: r => {
      successHaptic();
      toast.success(
        r.refundedCents > 0
          ? t('tournamentDetail.payments.refundIssued').replace(
              '{amount}',
              formatPrice(r.refundedCents, tournament?.currency ?? 'CAD', { locale })
            )
          : t('tournamentDetail.payments.withdrawnNoRefund')
      );
    },
    onError: e => showError(e.message, 'tournamentDetail.errors.withdrawFailed'),
  });
  const acceptInvite = useAcceptTournamentInvite({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.registerToast.registered'), inviteNudgeAction());
    },
    onError: e => showError(e.message, 'tournamentDetail.errors.acceptInviteFailed'),
  });
  const revokeInvite = useRevokeTournamentInvite({
    onSuccess: () => successHaptic(),
    onError: e => showError(e.message, 'tournamentDetail.errors.revokeInviteFailed'),
  });
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PlayerSearchResult | null>(null);
  const insets = useSafeAreaInsets();

  // Decline reuses the remove RPC (sets 'disqualified'); the ref lets the
  // shared mutation callbacks pick decline- vs remove-flavored copy.
  const declineModeRef = useRef(false);

  const removeRegistrant = useRemoveTournamentRegistration({
    onSuccess: () => {
      successHaptic();
      setRemoveTarget(null);
      toast.success(
        t(
          declineModeRef.current
            ? 'tournamentDetail.declineModal.success'
            : 'tournamentDetail.removeModal.success'
        )
      );
    },
    onError: e => {
      setRemoveTarget(null);
      showError(
        e.message,
        declineModeRef.current
          ? 'tournamentDetail.errors.declineFailed'
          : 'tournamentDetail.errors.removeFailed'
      );
    },
  });

  // Same roster affordance once the pools are drawn: the RPC swap turns the
  // leaver's unplayed pool games into walkovers for their opponents.
  const forfeitRegistrant = useForfeitTournamentRegistration({
    onSuccess: () => {
      successHaptic();
      setRemoveTarget(null);
      toast.success(t('tournamentDetail.forfeitModal.success'));
    },
    onError: e => {
      setRemoveTarget(null);
      showError(e.message, 'tournamentDetail.errors.forfeitFailed');
    },
  });

  const approveRegistrant = useApproveTournamentRegistration({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.dashboard.pendingRequests.approvedToast'));
    },
    onError: e => showError(e.message, 'tournamentDetail.errors.approveFailed'),
  });

  const cancel = useCancelTournament({
    onSuccess: () => {
      successHaptic();
      setShowCancelModal(false);
      setCancelReason('');
    },
    onError: e => {
      const msg = e.message.toLowerCase();
      const key: TranslationKey = msg.includes('not_cancellable')
        ? 'tournamentDetail.cancelModal.errorNotCancellable'
        : msg.includes('optimistic_lock')
          ? 'tournamentDetail.cancelModal.errorLockConflict'
          : 'tournamentDetail.cancelModal.errorGeneric';
      warningHaptic();
      toast.error(t(key));
    },
  });

  const archive = useArchiveTournament({
    onSuccess: () => {
      successHaptic();
      setShowArchiveModal(false);
    },
    onError: e => {
      const msg = e.message.toLowerCase();
      const key: TranslationKey = msg.includes('settlement_pending')
        ? 'tournamentDetail.archiveModal.errorSettlementPending'
        : msg.includes('not_archivable')
          ? 'tournamentDetail.archiveModal.errorNotArchivable'
          : msg.includes('optimistic_lock')
            ? 'tournamentDetail.archiveModal.errorLockConflict'
            : 'tournamentDetail.archiveModal.errorGeneric';
      warningHaptic();
      toast.error(t(key));
    },
  });

  const unarchive = useUnarchiveTournament({
    onSuccess: () => {
      successHaptic();
      toast.success(t('tournamentDetail.archiveModal.restoredToast'));
    },
    onError: e => {
      const msg = e.message.toLowerCase();
      warningHaptic();
      toast.error(
        t(
          msg.includes('optimistic_lock')
            ? 'tournamentDetail.archiveModal.errorLockConflict'
            : 'tournamentDetail.archiveModal.errorGeneric'
        )
      );
    },
  });

  const onUnarchive = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    unarchive.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, unarchive]);

  const onOpen = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    open.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, open]);

  const onClose = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    close.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, close]);

  const onReopen = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    reopen.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, reopen]);

  const isDoubles = !!tournament && tournament.entry_format !== 'singles';

  // Invite-only invitees land a 'pending' row the organizer never approves —
  // they accept it themselves (tournament_register flips pending → registered).
  // Distinct from approval-mode pending, which is passive (await organizer).
  const isInvitePending =
    !!myActiveRegistration &&
    myActiveRegistration.status === 'pending' &&
    tournament?.registration_mode === 'invite_only';

  // Organizer-initiated intra-app invite (any mode), marked by invited_by. The
  // invitee confirms via tournament_accept_invite — distinct from the legacy
  // invite_only self-accept path (isInvitePending) above.
  const isInvitedPending =
    !!myActiveRegistration &&
    myActiveRegistration.status === 'pending' &&
    !!myActiveRegistration.invited_by;

  const onRegister = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    // Registration is the conversion moment for a signed-out reader: the RPC
    // would answer NOT_AUTHENTICATED, so ask for the account instead.
    if (!guardAction()) return;
    // Accepting an existing pending invite flips it via tournament_register
    // (join-via-invite is idempotent on a pending row and wouldn't confirm it);
    // a fresh invitee with only a share link redeems the token. Organizers and
    // direct registrants take the normal path. Doubles routes through the
    // partner picker first in every case.
    const inviteToken = !isOrganizer && !isInvitePending ? params.inviteToken : undefined;
    // Paid tournaments charge via Stripe before confirming the spot. Share-link
    // holders included: redeeming a token used to skip this and call
    // joinViaInvite, which the paid gate rejects with PAYMENT_REQUIRED and no
    // route into payment, so the link just dead-ended. The token isn't needed to
    // pay — begin_paid_registration takes it from here.
    //
    // isInvitePending (invite_only + pending, no invited_by) still falls through
    // because that row can't exist on a paid tournament: the gate only admits a
    // pending row when invited_by is set, and those take the accept-invite CTA.
    if (isPaidTournament && !isInvitePending) {
      if (isDoubles) {
        void SheetManager.show('tournament-partner-picker', {
          payload: {
            sportId: tournament.sport_id,
            onPick: partner => {
              void handlePaidRegister(partner.id);
            },
          },
        });
        return;
      }
      void handlePaidRegister();
      return;
    }
    if (isDoubles) {
      void SheetManager.show('tournament-partner-picker', {
        payload: {
          sportId: tournament.sport_id,
          onPick: partner => {
            if (inviteToken) {
              joinViaInvite.mutate({
                token: inviteToken,
                tournamentId: tournament.id,
                partnerId: partner.id,
              });
            } else {
              register.mutate({ tournamentId: tournament.id, partnerId: partner.id });
            }
          },
        },
      });
      return;
    }
    if (inviteToken) {
      joinViaInvite.mutate({ token: inviteToken, tournamentId: tournament.id });
      return;
    }
    register.mutate({ tournamentId: tournament.id });
  }, [
    tournament,
    isDoubles,
    isInvitePending,
    register,
    joinViaInvite,
    params.inviteToken,
    isOrganizer,
    isPaidTournament,
    handlePaidRegister,
    guardAction,
  ]);

  const onWithdraw = useCallback(() => {
    if (!tournament || !myActiveRegistration) return;
    lightHaptic();

    // Paid registration: confirm with the refund estimate, then withdraw+refund.
    // Only a confirmed (paid) row has a captured payment to refund — an unpaid
    // pending invite falls through to the plain withdraw below.
    if (isPaidTournament && myActiveRegistration.status === 'registered') {
      const pastCutoff =
        !!feeQuote?.refundCutoffAt && new Date(feeQuote.refundCutoffAt) < new Date();
      const estimateCents = !feeQuote
        ? 0
        : feeQuote.refundPolicyKind === 'none' || pastCutoff
          ? 0
          : feeQuote.refundPolicyKind === 'full'
            ? feeQuote.entryCents
            : Math.round((feeQuote.entryCents * (feeQuote.refundPartialBps ?? 0)) / 10000);
      const currency = tournament.currency ?? 'CAD';
      const money = (cents: number) => formatPrice(cents, currency, { locale });
      // What the player was charged vs what comes back. The fee + its GST/QST
      // only exist on the player's side in player_pays mode.
      const feesKeptCents = feeQuote ? feeQuote.serviceFeeCents + feeQuote.feeTaxCents : 0;
      const playerPaidFee = !!feeQuote && feeQuote.feePayer === 'player_pays' && feesKeptCents > 0;
      const cutoffLabel = feeQuote?.refundCutoffAt
        ? new Date(feeQuote.refundCutoffAt).toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '';
      // Deadline passed reads differently from a no-refund policy: the player
      // had a refund window and missed it, so say that instead of "not
      // refundable" and let them confirm the withdrawal knowingly.
      const zeroLine =
        pastCutoff && feeQuote?.refundPolicyKind !== 'none'
          ? t('tournamentDetail.payments.withdrawConfirmCutoffPassed').replace(
              '{date}',
              cutoffLabel
            )
          : t('tournamentDetail.payments.withdrawConfirmNoRefund');
      const message = [
        feeQuote
          ? t('tournamentDetail.payments.withdrawConfirmPaid').replace(
              '{amount}',
              money(feeQuote.totalCents)
            )
          : null,
        estimateCents > 0
          ? t('tournamentDetail.payments.withdrawConfirmRefund').replace(
              '{amount}',
              money(estimateCents)
            )
          : zeroLine,
        estimateCents > 0 && playerPaidFee
          ? t('tournamentDetail.payments.withdrawConfirmFeesKept').replace(
              '{amount}',
              money(feesKeptCents)
            )
          : null,
      ]
        .filter(Boolean)
        .join('\n');
      Alert.alert(t('tournamentDetail.payments.withdrawConfirmTitle'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('tournamentDetail.actions.withdraw'),
          style: 'destructive',
          onPress: () =>
            refundRegistration.mutate({
              registrationId: myActiveRegistration.id,
              versionWas: myActiveRegistration.version,
              tournamentId: tournament.id,
            }),
        },
      ]);
      return;
    }

    withdraw.mutate({
      registrationId: myActiveRegistration.id,
      versionWas: myActiveRegistration.version,
      tournamentId: tournament.id,
    });
  }, [
    tournament,
    myActiveRegistration,
    withdraw,
    isPaidTournament,
    feeQuote,
    refundRegistration,
    t,
    locale,
  ]);

  const onAcceptInvite = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    // Paid tournaments: an invited player still pays the entry fee to claim the
    // slot. Same Stripe flow as self-register — begin_paid_registration reuses
    // the pending invite row, and the webhook confirms the spot after payment.
    if (isPaidTournament) {
      if (isDoubles) {
        void SheetManager.show('tournament-partner-picker', {
          payload: {
            sportId: tournament.sport_id,
            onPick: partner => {
              void handlePaidRegister(partner.id);
            },
          },
        });
        return;
      }
      void handlePaidRegister();
      return;
    }
    if (isDoubles) {
      void SheetManager.show('tournament-partner-picker', {
        payload: {
          sportId: tournament.sport_id,
          onPick: partner =>
            acceptInvite.mutate({ tournamentId: tournament.id, partnerId: partner.id }),
        },
      });
      return;
    }
    acceptInvite.mutate({ tournamentId: tournament.id });
  }, [tournament, isDoubles, acceptInvite, isPaidTournament, handlePaidRegister]);

  const onSetUpBracket = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    navigation.navigate('TournamentBracketSetup', { tournamentId: tournament.id });
  }, [tournament, navigation]);

  // Bracket: only fetch when the bracket has been generated (status >= in_progress).
  const bracketStatuses: ReadonlyArray<Enums<'tournament_status'>> = [
    'registration_closed',
    'in_progress',
    'completed',
    'archived',
  ];
  const shouldFetchBracket = !!tournament && bracketStatuses.includes(tournament.status);
  const { data: matches = [] } = useTournamentMatches(
    shouldFetchBracket ? tournament?.id : undefined
  );

  // Pool phase (pool_knockout only): the bracket tab shows pools first, then
  // the knockout tree once it exists. Single elim: every row is main-side.
  const isPoolTournament = tournament?.bracket_type === 'pool_knockout';
  const poolMatches = useMemo(() => matches.filter(m => m.bracket_side === 'pool'), [matches]);
  const knockoutMatches = useMemo(() => matches.filter(m => m.bracket_side === 'main'), [matches]);
  const { data: poolStandings = [] } = useTournamentPoolStandings(
    isPoolTournament && shouldFetchBracket ? tournament?.id : undefined
  );
  const poolPhaseComplete = poolsComplete(poolMatches);
  const generateKnockout = useGenerateTournamentKnockout();
  const handleGenerateKnockout = useCallback(() => {
    if (!tournament) return;
    generateKnockout.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
  }, [tournament, generateKnockout]);

  const { data: roundDeadlines = [] } = useTournamentRoundDeadlines(
    shouldFetchBracket && tournament?.status === 'in_progress' ? tournament?.id : undefined
  );

  // The phase the players are racing right now: the pool deadline while the
  // pool stage is live, else the earliest knockout round still unresolved.
  const currentPhaseDeadline = useMemo(() => {
    if (roundDeadlines.length === 0) return null;
    if (isPoolTournament && knockoutMatches.length === 0) {
      return roundDeadlines.find(d => d.bracket_side === 'pool')?.deadline_at ?? null;
    }
    const unresolvedRounds = new Set(
      knockoutMatches
        .filter(m => ['pending', 'in_progress', 'disputed'].includes(m.status))
        .map(m => m.round_number)
    );
    const next = roundDeadlines
      .filter(d => d.bracket_side === 'main' && unresolvedRounds.has(d.round_number))
      .sort((a, b) => a.deadline_at.localeCompare(b.deadline_at))[0];
    return next?.deadline_at ?? null;
  }, [roundDeadlines, isPoolTournament, knockoutMatches]);

  const deadlineUrgent = useCallback(
    (iso: string) => new Date(iso).getTime() - Date.now() <= 48 * 3600000,
    []
  );

  const formatDeadline = useCallback(
    (iso: string) => {
      const target = new Date(iso).getTime();
      const hoursLeft = Math.max(0, Math.round((target - Date.now()) / 3600000));
      if (hoursLeft <= 48) {
        return t('tournamentDetail.deadlines.hoursLeft' as TranslationKey).replace(
          '{hours}',
          String(hoursLeft)
        );
      }
      return t('tournamentDetail.deadlines.playBy' as TranslationKey).replace(
        '{date}',
        new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
      );
    },
    [t, locale]
  );

  // Map registration_id → seed number (1-indexed). The order matches the
  // RPC's seeding criteria so the labels here line up with the bracket.
  const seedByRegId = useMemo(() => {
    const map = new Map<string, number>();
    [...registrations]
      .sort((a, b) => {
        const sa = a.seed_rank ?? Number.MAX_SAFE_INTEGER;
        const sb = b.seed_rank ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        const ta = new Date(a.registered_at).getTime();
        const tb = new Date(b.registered_at).getTime();
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      })
      .forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [registrations]);

  // Map registration_id → member user ids (captain first, partner second for
  // doubles), used to decide whether the caller can tap into a bracket match.
  const membersByRegId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of registrations) {
      map.set(r.id, r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id]);
    }
    return map;
  }, [registrations]);

  // Batch-fetch player profiles so the bracket and players list can render
  // real names; includes the organizer for the hero byline.
  const userIds = useMemo(
    () => [
      ...registrations.flatMap(r =>
        r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id]
      ),
      // A removed entrant leaves the active roster but keeps its pool row, so
      // its profile still has to be fetched or that row renders nameless.
      ...poolStandings.flatMap(s =>
        s.partner_user_id ? [s.user_id, s.partner_user_id] : [s.user_id]
      ),
      ...(tournament ? [tournament.organizer_id] : []),
    ],
    [registrations, poolStandings, tournament]
  );
  const { data: profiles } = useProfilesByIds(userIds);
  const nameByRegId = useMemo(() => {
    const map = new Map<string, string>();
    // Always use first (+ last). display_name is intentionally ignored
    // per the app-wide convention in @rallia/shared-utils/getHumanName.
    // Doubles entries render as a pair label everywhere the registration is
    // shown: bracket slots, champion, opponent, score sheet. Two full names on
    // one line overflow essentially always, so pairs shorten to first name +
    // last initial ("Mathis L. & Jean-Daniel S."). Singles keep the full name,
    // where there is room for it.
    const labelFor = (userId: string, partnerUserId: string | null) => {
      const p = profiles?.[userId];
      const partner = partnerUserId ? profiles?.[partnerUserId] : undefined;
      return partner
        ? [getInitialName(p, ''), getInitialName(partner, '')].filter(Boolean).join(' & ')
        : p
          ? getHumanName(p, '')
          : '';
    };
    for (const r of registrations) {
      const label = labelFor(r.user_id, r.partner_user_id);
      if (label) map.set(r.id, label);
    }
    // Standings still carry withdrawn and disqualified entrants so their pool
    // row can be struck through, but listActiveRegistrations drops them, and
    // the row was falling back to a bare dash with nothing left to strike.
    for (const s of poolStandings) {
      if (map.has(s.registration_id)) continue;
      const label = labelFor(s.user_id, s.partner_user_id);
      if (label) map.set(s.registration_id, label);
    }
    return map;
  }, [registrations, poolStandings, profiles]);

  // Members of each registration as clickable avatar descriptors (captain first,
  // partner second for doubles), so bracket slots can show avatars that link to
  // each player's profile.
  const slotPlayersByRegId = useMemo(() => {
    const map = new Map<string, Array<{ id: string; avatarUrl: string | null }>>();
    for (const r of registrations) {
      const ids = r.partner_user_id ? [r.user_id, r.partner_user_id] : [r.user_id];
      map.set(
        r.id,
        ids.map(id => ({
          id,
          avatarUrl: getProfilePictureUrl(profiles?.[id]?.profile_picture_url),
        }))
      );
    }
    return map;
  }, [registrations, profiles]);

  // Seed-ordered participants enriched with rating/reputation/online, fetched
  // server-side so the Players tab renders full community PlayerCards.
  const { data: participantPlayers = [] } = useTournamentParticipants(params.tournamentId);

  // Registrant removal is a pre-bracket organizer tool; participant rows map
  // back to their registration (id + version) through user_id.
  const canRemoveRegistrants =
    isOrganizer &&
    (tournament?.status === 'registration_open' || tournament?.status === 'registration_closed');

  // After the draw the same row action forfeits instead of removing. Mirrors
  // tournament_forfeit_registration's gate: pools drawn, knockout not yet.
  const canForfeitRegistrants =
    isOrganizer &&
    isPoolTournament &&
    tournament?.status === 'in_progress' &&
    poolMatches.length > 0 &&
    knockoutMatches.length === 0;

  const registrationByUserId = useMemo(() => {
    const map = new Map<string, (typeof registrations)[number]>();
    for (const r of registrations) {
      map.set(r.user_id, r);
      // Removing either member of a doubles pair removes the whole entry.
      if (r.partner_user_id) map.set(r.partner_user_id, r);
    }
    return map;
  }, [registrations]);

  // Enriched participant cards keyed by player id, for the pending queue.
  const participantById = useMemo(() => {
    const map = new Map<string, PlayerSearchResult>();
    for (const p of participantPlayers) map.set(p.id, p);
    return map;
  }, [participantPlayers]);

  // Registered list excludes pending approvals — those render in PendingRequestsSection.
  const registeredParticipantPlayers = useMemo(
    () => participantPlayers.filter(p => registrationByUserId.get(p.id)?.status !== 'pending'),
    [participantPlayers, registrationByUserId]
  );

  // Organizer approval queue: one entry per pending registration, enriched with
  // the captain's participant card. Same pre-bracket + organizer gate as remove.
  const pendingRequestRows = useMemo<PendingRequestRow[]>(() => {
    if (!canRemoveRegistrants) return [];
    const rows: PendingRequestRow[] = [];
    for (const r of registrations) {
      // Only self-requested pendings need organizer approval. Organizer-sent
      // invites (invited_by) are awaiting the invitee's acceptance, not approval.
      if (r.status !== 'pending' || r.invited_by) continue;
      const player = participantById.get(r.user_id);
      if (player) rows.push({ player, registrationId: r.id, version: r.version });
    }
    return rows;
  }, [registrations, participantById, canRemoveRegistrants]);

  // Organizer-only: players invited via the in-app picker who haven't accepted
  // yet (status pending + invited_by). Shown read-only in the Players tab.
  const invitedPendingRows = useMemo<PendingRequestRow[]>(() => {
    if (!isOrganizer) return [];
    const rows: PendingRequestRow[] = [];
    for (const r of registrations) {
      if (r.status !== 'pending' || !r.invited_by) continue;
      const player = participantById.get(r.user_id);
      if (player) rows.push({ player, registrationId: r.id, version: r.version });
    }
    return rows;
  }, [registrations, participantById, isOrganizer]);

  // Players-tab status segments. Requests / Invited only exist while they hold
  // entries (both are organizer-gated upstream); the selection falls back to
  // Confirmed when its segment empties out.
  const [playersSegment, setPlayersSegment] = useState<PlayersSegment>('confirmed');
  const playersSegmentTabs = useMemo<UnderlineTabItem<PlayersSegment>[]>(() => {
    const tabs: UnderlineTabItem<PlayersSegment>[] = [
      {
        key: 'confirmed',
        label: t('tournamentDetail.dashboard.playerTabs.confirmed'),
        count: registeredParticipantPlayers.length,
        tone: 'positive',
      },
    ];
    // Requests need the organizer to act, so they run warm; invites are just
    // waiting on the invitee.
    if (pendingRequestRows.length > 0)
      tabs.push({
        key: 'requests',
        label: t('tournamentDetail.dashboard.playerTabs.requests'),
        count: pendingRequestRows.length,
        tone: 'warning',
      });
    if (invitedPendingRows.length > 0)
      tabs.push({
        key: 'invited',
        label: t('tournamentDetail.dashboard.playerTabs.invited'),
        count: invitedPendingRows.length,
        tone: 'info',
      });
    return tabs;
  }, [
    t,
    registeredParticipantPlayers.length,
    pendingRequestRows.length,
    invitedPendingRows.length,
  ]);
  const activePlayersSegment: PlayersSegment = playersSegmentTabs.some(
    tab => tab.key === playersSegment
  )
    ? playersSegment
    : 'confirmed';

  const handleRemovePress = useCallback((player: PlayerSearchResult) => {
    lightHaptic();
    setRemoveTarget(player);
  }, []);

  const handleRevokeInvite = useCallback(
    (row: PendingRequestRow) => {
      if (!tournament) return;
      lightHaptic();
      Alert.alert(
        t('tournamentDetail.dashboard.invited.revokeConfirmTitle'),
        t('tournamentDetail.dashboard.invited.revokeConfirmMessage').replace(
          '{name}',
          getHumanName(row.player, '')
        ),
        [
          { text: t('tournamentDetail.dashboard.invited.revokeCancel'), style: 'cancel' },
          {
            text: t('tournamentDetail.dashboard.invited.revokeConfirm'),
            style: 'destructive',
            onPress: () =>
              revokeInvite.mutate({
                registrationId: row.registrationId,
                versionWas: row.version,
                tournamentId: tournament.id,
              }),
          },
        ]
      );
    },
    [tournament, revokeInvite, t]
  );

  // Decline a pending request reuses the remove confirmation modal, but with
  // decline-flavored copy and the disqualify-is-terminal warning.
  const removeTargetIsPending = useMemo(
    () => (removeTarget ? registrationByUserId.get(removeTarget.id)?.status === 'pending' : false),
    [removeTarget, registrationByUserId]
  );

  // One roster affordance, three outcomes. Forfeit wins the pick because its
  // phase gate can't overlap remove's, and mid-pools it does more than shrink
  // the roster: the leaver's unplayed games become walkovers, so the standings
  // move for everyone in their pool.
  const removeModalCopy = canForfeitRegistrants
    ? 'forfeitModal'
    : removeTargetIsPending
      ? 'declineModal'
      : 'removeModal';
  // Only the remove/forfeit paths have a paid variant; a pending request never
  // reached checkout.
  const removeModalMessageKey: TranslationKey =
    isPaidTournament && removeModalCopy !== 'declineModal'
      ? `tournamentDetail.${removeModalCopy}.messagePaid`
      : `tournamentDetail.${removeModalCopy}.message`;

  const confirmRemove = useCallback(() => {
    if (!tournament || !removeTarget) return;
    const reg = registrationByUserId.get(removeTarget.id);
    if (!reg) {
      setRemoveTarget(null);
      warningHaptic();
      toast.error(t('tournamentDetail.errors.lockConflict'));
      return;
    }
    if (canForfeitRegistrants) {
      forfeitRegistrant.mutate({
        registrationId: reg.id,
        versionWas: reg.version,
        tournamentId: tournament.id,
      });
      return;
    }
    declineModeRef.current = reg.status === 'pending';
    removeRegistrant.mutate({
      registrationId: reg.id,
      versionWas: reg.version,
      tournamentId: tournament.id,
    });
  }, [
    tournament,
    removeTarget,
    registrationByUserId,
    canForfeitRegistrants,
    forfeitRegistrant,
    removeRegistrant,
    toast,
    t,
  ]);

  const handleApprovePress = useCallback(
    (registrationId: string, version: number) => {
      if (!tournament || approveRegistrant.isPending) return;
      lightHaptic();
      approveRegistrant.mutate({
        registrationId,
        versionWas: version,
        tournamentId: tournament.id,
      });
    },
    [tournament, approveRegistrant]
  );

  // Opening a player profile stays behind the guard the player directory uses,
  // so a roster is not a way around it.
  const handlePlayerPress = useCallback(
    (player: PlayerSearchResult) => {
      if (!tournament) return;
      lightHaptic();
      if (!guardAction()) return;
      navigation.navigate('PlayerProfile', {
        playerId: player.id,
        sportId: tournament.sport_id,
      });
    },
    [navigation, tournament, guardAction]
  );

  // Tapping a bracket-slot avatar opens that player's profile (by user id).
  const handleBracketPlayerPress = useCallback(
    (playerId: string) => {
      if (!tournament) return;
      lightHaptic();
      if (!guardAction()) return;
      navigation.navigate('PlayerProfile', {
        playerId,
        sportId: tournament.sport_id,
      });
    },
    [navigation, tournament, guardAction]
  );

  // ---------------------------------------------------------------------------
  // Dashboard-derived state
  // ---------------------------------------------------------------------------

  const organizerName = useMemo(() => {
    if (!tournament) return '';
    // Official events carry a brand override so they read "Rallia" rather than
    // whichever team member owns the row; player-run events fall back to the
    // organizer's profile.
    const brand = tournament.organizer_display_name?.trim();
    if (brand) return brand;
    const p = profiles?.[tournament.organizer_id];
    return p ? getHumanName(p, '') : '';
  }, [profiles, tournament]);

  // Doubles: the other member of the caller's pair, for the hero label.
  const myPartnerName = useMemo(() => {
    if (!myActiveRegistration?.partner_user_id || !userId) return '';
    const otherId =
      myActiveRegistration.user_id === userId
        ? myActiveRegistration.partner_user_id
        : myActiveRegistration.user_id;
    const p = profiles?.[otherId];
    return p ? getHumanName(p, '') : '';
  }, [myActiveRegistration, userId, profiles]);

  const myRegId = myActiveRegistration?.id ?? null;

  // Round math is knockout-only: pool rounds carry their own numbering and
  // must never shift the Final/Semifinal labels or the champion lookup.
  const totalRounds = useMemo(
    () => knockoutMatches.reduce((max, m) => Math.max(max, m.round_number), 0),
    [knockoutMatches]
  );

  const championName = useMemo(() => {
    if (!totalRounds) return null;
    const final = knockoutMatches.find(
      m => m.round_number === totalRounds && m.winner_registration_id
    );
    if (!final?.winner_registration_id) return null;
    return (
      nameByRegId.get(final.winner_registration_id) ??
      seedFallbackLabel(seedByRegId.get(final.winner_registration_id), t)
    );
  }, [knockoutMatches, totalRounds, nameByRegId, seedByRegId, t]);

  // Playable games only — bye/phantom slots auto-advance and are never played.
  const matchProgress = useMemo(() => {
    const real = matches.filter(m => !m.player1_is_bye && !m.player2_is_bye);
    return { done: real.filter(m => !!m.winner_registration_id).length, total: real.length };
  }, [matches]);

  const myNextMatch = useMemo(() => {
    if (!myRegId) return null;
    return (
      matches
        .filter(
          m =>
            m.status === 'pending' &&
            !m.player1_is_bye &&
            !m.player2_is_bye &&
            (m.player1_registration_id === myRegId || m.player2_registration_id === myRegId)
        )
        .sort((a, b) => a.round_number - b.round_number)[0] ?? null
    );
  }, [matches, myRegId]);

  // My game's effective deadline: per-match extension wins over the phase row.
  const myNextMatchDeadline = useMemo(() => {
    if (!myNextMatch) return null;
    if (myNextMatch.deadline_override_at) return myNextMatch.deadline_override_at;
    const row = roundDeadlines.find(d =>
      myNextMatch.bracket_side === 'pool'
        ? d.bracket_side === 'pool'
        : d.bracket_side === 'main' && d.round_number === myNextMatch.round_number
    );
    return row?.deadline_at ?? null;
  }, [myNextMatch, roundDeadlines]);

  const myBracketState = useMemo<'next' | 'waiting' | 'eliminated' | 'champion' | null>(() => {
    if (!myRegId || tournament?.status !== 'in_progress') return null;
    if (myNextMatch) {
      return myNextMatch.player1_registration_id && myNextMatch.player2_registration_id
        ? 'next'
        : 'waiting';
    }
    // Losing a pool game is not elimination; only knockout losses are.
    const mine = knockoutMatches.filter(
      m => m.player1_registration_id === myRegId || m.player2_registration_id === myRegId
    );
    if (mine.some(m => m.winner_registration_id && m.winner_registration_id !== myRegId)) {
      return 'eliminated';
    }
    const final = knockoutMatches.find(m => m.round_number === totalRounds);
    return final?.winner_registration_id === myRegId ? 'champion' : 'waiting';
  }, [myRegId, tournament?.status, myNextMatch, knockoutMatches, totalRounds]);

  const myOpponentLabel = useMemo(() => {
    if (!myNextMatch || !myRegId) return null;
    const oppId =
      myNextMatch.player1_registration_id === myRegId
        ? myNextMatch.player2_registration_id
        : myNextMatch.player1_registration_id;
    if (!oppId) return null;
    return nameByRegId.get(oppId) ?? seedFallbackLabel(seedByRegId.get(oppId), t);
  }, [myNextMatch, myRegId, nameByRegId, seedByRegId, t]);

  // Flashscore-style content tabs (Overview / Bracket / Players / Details).
  // Keyed, not positional: tabs appear and disappear with tournament state, so
  // an index would silently select a different tab underneath the user.
  const [activeTabKey, setActiveTabKey] = useState<TabKey>('overview');

  // Tab switches scroll back to the tab bar (measured, since the hero varies in
  // height) so a new pane never opens mid-content.
  const scrollRef = useRef<ScrollView>(null);
  const heroHeightRef = useRef(0);

  const handleBracketMatchTap = useCallback(
    (tournamentMatchId: string, p1RegId: string, p2RegId: string) => {
      const team1 = membersByRegId.get(p1RegId);
      const team2 = membersByRegId.get(p2RegId);
      if (!team1?.length || !team2?.length || !tournament) return;
      lightHaptic();
      SheetManager.show('tournament-link-match', {
        payload: {
          tournamentMatchId,
          tournamentId: tournament.id,
          sportId: tournament.sport_id,
          entryFormat: tournament.entry_format,
          team1UserIds: team1,
          team2UserIds: team2,
        },
      });
    },
    [membersByRegId, tournament]
  );

  // Open (get-or-create) the per-pairing round chat and drop the caller in, so
  // they can organize the game with their opponent (creating it links the match
  // to this bracket round, and the chat becomes the match chat — no duplicate).
  const openRoundChat = useOpenTournamentRoundChat();
  const handleOpenRoundChat = useCallback(
    (tournamentMatchId: string) => {
      lightHaptic();
      openRoundChat.mutate(tournamentMatchId, {
        onSuccess: conversationId => {
          navigation.navigate('ChatConversation', {
            conversationId,
            title: tournament?.name,
          });
        },
        onError: () => {
          toast.error(t('tournamentDetail.dashboard.myMatch.organizeError'));
        },
      });
    },
    [openRoundChat, navigation, tournament?.name, toast, t]
  );

  // Organizer-only: record an authoritative result for a stalled/disputed
  // bracket match via the structured set-entry sheet.
  const handleOrganizerOverride = useCallback(
    (tournamentMatchId: string, p1RegId: string, p2RegId: string) => {
      if (!tournament) return;
      lightHaptic();
      const sportName = sports.find(s => s.id === tournament.sport_id)?.name;
      const match = matches.find(m => m.id === tournamentMatchId);
      SheetManager.show('tournament-record-score', {
        payload: {
          tournamentMatchId,
          tournamentId: tournament.id,
          player1RegId: p1RegId,
          player2RegId: p2RegId,
          player1Name: nameByRegId.get(p1RegId) ?? seedFallbackLabel(seedByRegId.get(p1RegId), t),
          player2Name: nameByRegId.get(p2RegId) ?? seedFallbackLabel(seedByRegId.get(p2RegId), t),
          isPickleball: sportName === 'pickleball',
          matchFormat: tournament.match_format,
          pointsPerGame: tournament.points_per_game,
          isFinal:
            !!totalRounds && match?.bracket_side === 'main' && match?.round_number === totalRounds,
          // A pool row can be cancelled outright; a bracket slot cannot.
          isPoolMatch: match?.pool_number != null,
          onSuccess: () => {
            successHaptic();
          },
        },
      });
    },
    [tournament, sports, matches, totalRounds, nameByRegId, seedByRegId, t]
  );

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ScreenColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      primary: isDark ? primary[500] : primary[600],
      statusNeutralBg: isDark ? neutral[700] : neutral[200],
      statusNeutralText: isDark ? neutral[100] : neutral[700],
      statusPositiveBg: isDark ? '#16a34a30' : '#dcfce7',
      statusPositiveText: isDark ? '#86efac' : '#15803d',
      statusActiveBg: isDark ? `${primary[500]}30` : `${primary[600]}20`,
      statusActiveText: isDark ? primary[300] : primary[700],
      statusMutedBg: isDark ? neutral[800] : neutral[100],
      statusMutedText: isDark ? neutral[400] : neutral[500],
      cancelledBg: isDark ? '#7c2d1230' : accent[100],
      cancelledBorder: isDark ? status.warning.DEFAULT : status.warning.light,
      cancelledText: isDark ? status.warning.light : accent[800],
      highlightBg: isDark ? primary[950] : primary[50],
      highlightBorder: isDark ? `${primary[400]}40` : `${primary[500]}20`,
      secondaryHighlightBg: isDark ? secondary[950] : secondary[50],
      secondaryHighlightBorder: isDark ? `${secondary[400]}40` : `${secondary[500]}20`,
      secondaryAccent: isDark ? secondary[400] : secondary[500],
      secondaryAccentBg: isDark ? `${secondary[500]}30` : `${secondary[500]}20`,
      championBg: isDark ? `${accent[400]}25` : `${accent[500]}15`,
      championText: isDark ? accent[400] : accent[600],
      danger: isDark ? secondary[400] : secondary[500],
      dangerBg: isDark ? `${secondary[500]}30` : `${secondary[500]}1f`,
    }),
    [themeColors, isDark]
  );

  // Organizer admin actions surfaced via the header "⋯" overflow menu.
  const adminActions = useMemo(() => {
    const s = tournament?.status;
    // Details are only editable before registration closes (draft / open).
    const canEdit = s === 'draft' || s === 'registration_open';
    // Links can be shared ahead of opening — they redeem once registration opens.
    const canInvite = s === 'draft' || s === 'registration_open';
    const canCancel =
      s === 'draft' ||
      s === 'registration_open' ||
      s === 'registration_closed' ||
      s === 'in_progress';
    const canArchive = s === 'completed' || s === 'cancelled';
    // Archiving used to be a one-way door: the row left every list with no way
    // back. It restores to whichever status it was archived from.
    const canUnarchive = s === 'archived';
    // Reopen a closed window for late entrants, while the bracket isn't generated.
    const canReopen = s === 'registration_closed' && !tournament?.bracket_locked_at;
    // The shareable invite link stays active until the bracket is published: even
    // after registration closes, the organizer can still admit late entrants by
    // link (draft/open already reach the link through the "Invite players" sheet).
    const canShareLink = s === 'registration_closed' && !tournament?.bracket_locked_at;
    // Mirrors the RPC's own status gate, and only once there is something to
    // set: a pool phase (known from the format, before the draw) or generated
    // knockout rounds. Otherwise the entry opens on an empty sheet.
    const canSetDeadlines =
      (s === 'registration_open' || s === 'registration_closed' || s === 'in_progress') &&
      (isPoolTournament || knockoutMatches.length > 0);
    const enabled =
      isOrganizer &&
      (canEdit ||
        canInvite ||
        canReopen ||
        canShareLink ||
        canSetDeadlines ||
        canCancel ||
        canArchive ||
        canUnarchive);
    return {
      canEdit,
      canInvite,
      canReopen,
      canShareLink,
      canSetDeadlines,
      canCancel,
      canArchive,
      canUnarchive,
      enabled,
    };
  }, [
    isOrganizer,
    tournament?.status,
    tournament?.bracket_locked_at,
    isPoolTournament,
    knockoutMatches.length,
  ]);

  // Creation-success handoff: land here with openInviteSheet=true and the
  // invite sheet opens once, after the screen settles. The param is cleared
  // inside the timeout — clearing it synchronously re-runs this effect and
  // the cleanup would cancel the timer before it fires.
  useEffect(() => {
    if (!params.openInviteSheet || !isOrganizer || !tournament) return;
    const { id: tournamentId, name: tournamentName } = tournament;
    const timer = setTimeout(() => {
      navigation.setParams({ openInviteSheet: undefined });
      void SheetManager.show('tournament-invite', {
        payload: { tournamentId, tournamentName },
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [params.openInviteSheet, isOrganizer, tournament, navigation]);

  const sport = useMemo(
    () => sports.find(s => s.id === tournament?.sport_id),
    [sports, tournament]
  );

  // Edit/Invite are reachable from the header overflow, a prominent Overview
  // action row, and the Players tab — so the open logic lives in one callback.
  const handleEditDetails = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    openSheetForTournamentEdit({
      id: tournament.id,
      version: tournament.version,
      status: tournament.status,
      name: tournament.name,
      description: tournament.description,
      rules: tournament.rules,
      logoUrl: tournament.logo_url,
      minRating: tournament.min_rating,
      maxRating: tournament.max_rating,
      visibility: tournament.visibility,
      startDate: tournament.start_date,
      endDate: tournament.end_date,
      maxParticipants: tournament.max_participants,
      bracketType: tournament.bracket_type,
      matchFormat: tournament.match_format,
      pointsPerGame: tournament.points_per_game,
      sport: {
        id: tournament.sport_id,
        name: sport?.name ?? '',
        display_name: sport?.display_name ?? '',
      },
      facilityId: tournament.facility_id,
      venueName: tournament.venue_name,
      venueAddress: tournament.venue_address,
      city: tournament.city,
      prizeMoneyCents: tournament.prize_money_cents,
      entryFeeCents: tournament.entry_fee_cents,
      currency: tournament.currency,
      feePayer: tournament.fee_payer,
      refundPolicyKind: tournament.refund_policy_kind,
      refundPartialBps: tournament.refund_partial_bps,
      refundCutoffAt: tournament.refund_cutoff_at,
    });
  }, [tournament, sport, openSheetForTournamentEdit]);

  const handleInvitePlayers = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    // Open the in-app player picker (which also offers "share a link instead").
    // Exclude the organizer and anyone already registered/pending/invited.
    const excludeUserIds = [
      ...registrations
        .filter(r => r.status === 'registered' || r.status === 'pending')
        .flatMap(r => [r.user_id, r.partner_user_id]),
      userId,
    ].filter((x): x is string => !!x);
    void SheetManager.show('tournament-invite-players', {
      payload: {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        sportId: tournament.sport_id,
        excludeUserIds,
      },
    });
  }, [tournament, registrations, userId]);

  // Every automated resolution keys on a deadline; with none set, nothing
  // resolves and the organizer is back to chasing players by hand.
  const handleSetDeadlines = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    const knockoutRounds = Array.from(new Set(knockoutMatches.map(m => m.round_number))).sort(
      (a, b) => a - b
    );
    void SheetManager.show('tournament-deadlines', {
      payload: {
        tournamentId: tournament.id,
        hasPoolPhase: isPoolTournament,
        knockoutRounds,
        totalRounds,
      },
    });
  }, [tournament, knockoutMatches, isPoolTournament, totalRounds]);

  const handleManageCoOrganizers = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    void SheetManager.show('tournament-co-organizers', {
      payload: {
        tournamentId: tournament.id,
        sportId: tournament.sport_id,
        organizerId: tournament.organizer_id,
      },
    });
  }, [tournament]);

  // Any player can invite friends into a public, open tournament: their link
  // redeems through the normal rules (band applies, approval mode queues), so
  // sharing it hands out no privilege the sharer doesn't have. Mirrors the mint
  // conditions in tournament_invite_get_or_create.
  const canPlayerShare =
    !isOrganizer &&
    tournament?.visibility === 'public' &&
    tournament?.status === 'registration_open' &&
    tournament?.registration_mode !== 'invite_only';

  // Post-close, pre-bracket: hand the organizer the still-active share link so
  // they can admit late entrants (the in-app invite picker closes with the
  // registration window, but the link stays live until the bracket publishes).
  const handleShareInviteLink = useCallback(() => {
    if (!tournament) return;
    lightHaptic();
    void SheetManager.show('tournament-invite', {
      payload: { tournamentId: tournament.id, tournamentName: tournament.name },
    });
  }, [tournament]);

  useEffect(() => {
    navigation.setOptions({
      headerRight:
        adminActions.enabled || canPlayerShare
          ? () => (
              <View style={styles.headerActions}>
                {canPlayerShare && (
                  <TouchableOpacity
                    onPress={handleShareInviteLink}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('tournamentDetail.invite.shareCta')}
                    style={styles.headerMenuButton}
                    testID="tournament-player-share"
                  >
                    <Ionicons name="share-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
                )}
                {adminActions.enabled && (
                  <TouchableOpacity
                    onPress={() => {
                      lightHaptic();
                      setShowActionsMenu(true);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('tournamentDetail.sections.manage')}
                    style={styles.headerMenuButton}
                    testID="tournament-overflow-menu"
                  >
                    <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
                  </TouchableOpacity>
                )}
              </View>
            )
          : undefined,
    });
  }, [navigation, adminActions.enabled, canPlayerShare, handleShareInviteLink, colors.text, t]);

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  // Pull-to-refresh: results, rosters and paid-registration state all settle
  // server-side after the user leaves the screen, so refetch the whole set.
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tournamentKeys.detail(params.tournamentId) }),
        queryClient.invalidateQueries({
          queryKey: tournamentKeys.registrations(params.tournamentId),
        }),
        queryClient.invalidateQueries({
          queryKey: tournamentKeys.participants(params.tournamentId),
        }),
        queryClient.invalidateQueries({ queryKey: tournamentKeys.matches(params.tournamentId) }),
        // The roster can move server-side while the user sits here, so the card's
        // count chip is refreshed alongside the rest.
        queryClient.invalidateQueries({ queryKey: tournamentKeys.lists() }),
        userId
          ? queryClient.invalidateQueries({
              queryKey: tournamentKeys.myRegistration(params.tournamentId, userId),
            })
          : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, params.tournamentId, userId]);

  if (isLoading || (invitePreviewEnabled && invitePreviewLoading)) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <TournamentDetailSkeleton />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {t('tournamentDetail.loadError')}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text size="base" weight="semibold" color="#ffffff">
              {t('tournamentDetail.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!tournament) {
    return (
      <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
          <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
            {inviteInvalid
              ? t('tournamentDetail.inviteLanding.invalidTitle')
              : t('tournamentDetail.notFound')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centeredSubtext}>
            {inviteInvalid
              ? t('tournamentDetail.inviteLanding.invalidDescription')
              : t('tournamentDetail.notFoundDescription')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const daysToStart = Math.round(
    (new Date(tournament.start_date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86_400_000
  );
  const spotsLeft = Math.max(0, tournament.max_participants - activeCount);
  const isLive = tournament.status === 'in_progress';
  const isFinished = tournament.status === 'completed' || tournament.status === 'archived';
  // Cancellation survives archival (status flips to 'archived', cancelled_at stays set),
  // so drive cancelled-state UI off the timestamp, not the live status.
  const wasCancelled = tournament.status === 'cancelled' || tournament.cancelled_at != null;
  const stepIndex =
    tournament.status === 'draft'
      ? 0
      : tournament.status === 'registration_open' || tournament.status === 'registration_closed'
        ? 1
        : isLive
          ? 2
          : 3;
  // Kept short: this sits in a narrow stats segment, so dates show as "Jul 26"
  // rather than countdown phrases that would wrap. Status already lives in the
  // hero badge, so once play starts the tile shows the end date instead.
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const startTileLabel =
    isLive || isFinished
      ? t('tournamentDetail.dashboard.stats.end')
      : t('tournamentDetail.dashboard.stats.start');
  const startTileValue =
    isLive || isFinished
      ? shortDate(tournament.end_date)
      : daysToStart === 0
        ? t('tournamentDetail.dashboard.stats.startsToday')
        : shortDate(tournament.start_date);
  const myMatchP1 = myNextMatch?.player1_registration_id ?? null;
  const myMatchP2 = myNextMatch?.player2_registration_id ?? null;
  const registerCloseHint = tournament.registration_closes_at
    ? t('tournamentList.registerBy').replace(
        '{date}',
        formatDate(tournament.registration_closes_at)
      )
    : null;

  // Paid-registration display: total to charge + a one-line refund summary.
  // Post-credit, matching the confirmation sheet: the CTA and the sheet must
  // never disagree one tap apart.
  const feeTotalLabel =
    isPaidTournament && feeQuote
      ? formatPrice(
          Math.max(feeQuote.totalCents - (feeQuote.creditApplicableCents ?? 0), 0),
          feeQuote.currency,
          { locale }
        )
      : null;
  const refundSummary = isPaidTournament ? refundPolicyLine(feeQuote, t, locale) : null;
  const registerBusy = registerPending || createRegistrationPayment.isPending;

  // Late entry by share link: registration closed but the bracket isn't
  // published, so a still-active invite link still gets a visitor in.
  const canLateEnterViaInvite =
    !isOrganizer &&
    tournament.status === 'registration_closed' &&
    !tournament.bracket_locked_at &&
    !!params.inviteToken &&
    !isPaidTournament &&
    !myActiveRegistration &&
    spotsLeft > 0;

  const spotsLeftLabel =
    spotsLeft > 0
      ? t(
          isDoubles
            ? 'tournamentDetail.dashboard.registerCta.spotsLeftTeams'
            : 'tournamentDetail.dashboard.registerCta.spotsLeft'
        ).replace('{n}', String(spotsLeft))
      : null;

  /**
   * The one state-advancing action for this viewer, docked to the bottom of the
   * screen so the conversion moment is never below the fold. Everything else
   * (utilities, withdraw, informational cards) stays in the Overview tab.
   * Null once the tournament is cancelled, finished, or there's nothing to do.
   */
  const primaryAction: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    disabled: boolean;
    hint: string | null;
    testID: string;
  } | null = (() => {
    if (wasCancelled || isFinished || isLive) return null;
    const withFee = (base: string) => (feeTotalLabel ? `${base} · ${feeTotalLabel}` : base);
    const registerHint = [spotsLeftLabel, registerCloseHint, refundSummary]
      .filter(Boolean)
      .join(' · ');

    // Organizer-sent invite: accepted via tournament_accept_invite.
    if (isInvitedPending) {
      const busy = acceptInvite.isPending || createRegistrationPayment.isPending;
      return {
        label: busy
          ? t('tournamentDetail.actions.accepting')
          : withFee(t('tournamentDetail.actions.acceptInvite')),
        icon: 'checkmark-circle-outline',
        onPress: onAcceptInvite,
        disabled: busy,
        hint: refundSummary,
        testID: 'cta-accept-tournament-invite',
      };
    }
    // Invite-only invitee confirming their own pending row.
    if (isInvitePending) {
      return {
        label: registerPending
          ? t('tournamentDetail.actions.accepting')
          : t('tournamentDetail.actions.acceptInvite'),
        icon: 'checkmark-circle-outline',
        onPress: onRegister,
        disabled: registerPending,
        hint: null,
        testID: 'cta-accept-invite',
      };
    }
    if (!isOrganizer && !myActiveRegistration) {
      if (tournament.status === 'registration_open' && spotsLeft > 0) {
        return {
          label: registerBusy
            ? t('tournamentDetail.actions.registering')
            : withFee(t('tournamentDetail.actions.register')),
          icon: 'person-add-outline',
          onPress: onRegister,
          disabled: registerBusy,
          hint: registerHint || null,
          testID: 'cta-register',
        };
      }
      if (canLateEnterViaInvite) {
        return {
          label: registerBusy
            ? t('tournamentDetail.actions.registering')
            : t('tournamentDetail.actions.register'),
          icon: 'person-add-outline',
          onPress: onRegister,
          disabled: registerBusy,
          hint: t('tournamentDetail.dashboard.registerCta.inviteLateDescription'),
          testID: 'cta-register-invite-late',
        };
      }
    }
    if (isOrganizer) {
      if (tournament.status === 'draft') {
        return {
          label: open.isPending
            ? t('tournamentDetail.actions.opening')
            : t('tournamentDetail.actions.openRegistration'),
          icon: 'lock-open-outline',
          onPress: onOpen,
          disabled: open.isPending,
          hint: t('tournamentDetail.dashboard.nextStep.draftDescription'),
          testID: 'cta-open-registration',
        };
      }
      if (tournament.status === 'registration_open') {
        return {
          label: close.isPending
            ? t('tournamentDetail.actions.closing')
            : t('tournamentDetail.actions.closeRegistration'),
          icon: 'lock-closed-outline',
          onPress: onClose,
          disabled: close.isPending,
          hint: t('tournamentDetail.dashboard.nextStep.openDescription')
            .replace('{count}', String(registeredCount))
            .replace('{max}', String(tournament.max_participants)),
          testID: 'cta-close-registration',
        };
      }
      if (tournament.status === 'registration_closed') {
        return {
          label: t('tournamentDetail.actions.setUpBracket'),
          icon: 'git-network-outline',
          onPress: onSetUpBracket,
          disabled: false,
          hint: t('tournamentDetail.dashboard.nextStep.closedDescription').replace(
            '{count}',
            String(registeredCount)
          ),
          testID: 'cta-setup-bracket',
        };
      }
    }
    return null;
  })();

  /** Organizer utilities, rendered as one quiet grouped list in the Overview. */
  const organizerRows: Array<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    badge?: { label: string; tone: 'positive' | 'warning' | 'muted' };
    testID: string;
  }> = [];
  if (isOrganizer) {
    if (adminActions.canInvite) {
      organizerRows.push({
        icon: 'share-social-outline',
        label: t('tournamentDetail.actions.invitePlayers'),
        onPress: handleInvitePlayers,
        testID: 'action-invite-players',
      });
    }
    if (tournament.status === 'registration_open' && !myActiveRegistration) {
      organizerRows.push({
        icon: 'person-add-outline',
        label: register.isPending
          ? t('tournamentDetail.actions.registering')
          : t('tournamentDetail.actions.addMyself'),
        onPress: onRegister,
        testID: 'cta-add-myself',
      });
    }
    // Primary check repeated: the account cache is keyed per player, so a
    // co-organizer running their own paid event would see a stale hit here.
    // undefined = still loading; the row appears once the status is known.
    if (isPrimaryOrganizer && isPaidTournament && payoutAccount !== undefined) {
      organizerRows.push({
        icon: 'wallet-outline',
        label: t('tournamentDetail.payments.payoutRow.label'),
        onPress: payoutAccount === null ? promptOnboardPayouts : () => void handleManagePayouts(),
        badge: isOpeningPayoutDashboard
          ? { label: t('tournamentDetail.payments.payoutRow.opening'), tone: 'muted' }
          : payoutAccount === null
            ? { label: t('tournamentDetail.payments.payoutRow.setup'), tone: 'muted' }
            : !payoutAccount.chargesEnabled
              ? { label: t('tournamentDetail.payments.payoutRow.actionNeeded'), tone: 'warning' }
              : { label: t('tournamentDetail.payments.payoutRow.ready'), tone: 'positive' },
        testID: 'action-payouts',
      });
    }
    // Per-event money summary. Only in-app place an organizer can see what
    // this event collected; the Stripe dashboard is account-wide.
    if (isPrimaryOrganizer && isPaidTournament && earnings !== undefined) {
      organizerRows.push({
        icon: 'cash-outline',
        label: t('tournamentDetail.earnings.row'),
        onPress: showEarnings,
        badge: {
          label: formatPrice(earnings.netToOrganizerCents, earnings.currency ?? 'CAD', { locale }),
          tone: earnings.paidCount > 0 ? 'positive' : 'muted',
        },
        testID: 'action-earnings',
      });
    }
    if (adminActions.canEdit) {
      organizerRows.push({
        icon: 'create-outline',
        label: t('tournamentDetail.actions.editDetails'),
        onPress: handleEditDetails,
        testID: 'action-edit-details',
      });
    }
    if (canManageCoOrganizers) {
      organizerRows.push({
        icon: 'people-circle-outline',
        label: t('tournamentDetail.coOrganizers.ctaTitle'),
        onPress: handleManageCoOrganizers,
        testID: 'action-manage-co-organizers',
      });
    }
  }

  // Details-tab spec-sheet values: level requirement, venue, and the money
  // (entry fee / what the player pays / prize) so every attribute set at
  // creation has a persistent home beyond the glanceable hero.
  const ratingRangeLabel = formatRatingRange(tournament.min_rating, tournament.max_rating);
  const rankingHeadline = tournamentRankingHeadline(tournament);
  const showRegisteredChip =
    !!myActiveRegistration && !wasCancelled && tournament.status !== 'archived';
  const showRankingChip = !!rankingHeadline && awardsRankingPoints;
  const entryFeeLabel = isPaidTournament
    ? formatPrice(tournament.entry_fee_cents, tournament.currency, { locale, trimZeroCents: true })
    : null;
  // Two different numbers, deliberately — see prizeLabel.ts. The spec sheet's
  // row is labelled "Bourse", so it carries the whole pool; the unlabelled
  // trophy pill answers "what could I win", so it carries the champion's cut.
  const prizePoolLabel = prizeAmountLabel(tournament, locale, t, 'pool');
  const prizeTopLabel = prizeAmountLabel(tournament, locale, t, 'top');
  const hasVenueDetails = !!(tournament.venue_name || tournament.venue_address || tournament.city);
  // Address line under the venue name; when only a city is known it's the primary
  // line instead, so it isn't repeated here.
  const venueSecondaryLine = [
    tournament.venue_address,
    tournament.venue_name ? tournament.city : null,
  ]
    .filter(Boolean)
    .join(', ');
  const showFeesSection = isPaidTournament || !!prizePoolLabel;
  // Only surface "You pay" when a service fee is added on top of the entry fee
  // (player-absorbs mode); organizer-absorbs makes the two amounts equal.
  const playerPaysServiceFee = !!feeQuote && feeQuote.totalCents > feeQuote.entryCents;

  // The draw shape a pool entrant is actually buying: how many pools, who
  // advances, and the games everyone is guaranteed. Computed off the full
  // bracket size, which is what the copy claims ("{field} players: ...") — the
  // real field is only known once registration closes.
  const poolFormatLabel =
    tournament.bracket_type === 'pool_knockout'
      ? poolPreviewText(
          tournament.max_participants,
          tournament.pool_size ?? 4,
          tournament.qualifiers_per_pool ?? 2,
          isDoubles,
          t
        )
      : null;

  // Expectations the spec sheet leaves implicit and a registrant pays to find
  // out otherwise: courts aren't included, games are self-scheduled, and a
  // cancelled event refunds every paid entry (lt-settle-event-payments).
  const goodToKnowLines = [
    t('tournamentDetail.goodToKnow.courts'),
    t('tournamentDetail.goodToKnow.scheduling'),
    isPaidTournament ? t('tournamentDetail.goodToKnow.cancelRefund') : null,
  ].filter((l): l is string => !!l);

  // Circuit Rallia eligibility. The ranking ceiling is stamped on EVERY
  // tournament, certified organizer or not, so the ceiling alone would promise
  // points the award will never pay — the certification is the real gate.
  const pointsLadder = awardsRankingPoints ? tournamentPointsLadder(tournament) : null;
  const showPointsTab = !!pointsLadder;

  const showBracketTab = shouldFetchBracket && matches.length > 0;
  const showPlayersTab = tournament.status !== 'draft';
  const showRulesTab = !!tournament.rules?.trim();
  // Split rules into per-line rows so each rule reads as its own item. Falls
  // back to the whole string as one row when the organizer wrote a paragraph.
  const rulesLines = (tournament.rules ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  // Overview → Bracket → Rules → Points → Players → Details. Bracket sits up
  // front because it's the tab that matters most once play starts; everything
  // else follows the reading order of "what is this / what do I win / who's in".
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: t('tournamentDetail.tabs.overview') },
    ...(showBracketTab
      ? [{ key: 'bracket' as const, label: t('tournamentDetail.tabs.bracket') }]
      : []),
    ...(showRulesTab ? [{ key: 'rules' as const, label: t('tournamentDetail.tabs.rules') }] : []),
    ...(showPointsTab
      ? [{ key: 'points' as const, label: t('tournamentDetail.tabs.points') }]
      : []),
    ...(showPlayersTab
      ? [{ key: 'players' as const, label: t('tournamentDetail.tabs.players') }]
      : []),
    { key: 'details', label: t('tournamentDetail.tabs.details') },
  ];
  // The selected tab can vanish (bracket published, rules cleared) — fall back
  // to Overview rather than rendering an empty pane.
  const currentTabKey = tabs.some(tab => tab.key === activeTabKey) ? activeTabKey : 'overview';
  const hasPlayersTab = tabs.some(tab => tab.key === 'players');

  /** Tab-bar taps: switch panes and leave the scroll position alone. */
  const selectTab = (key: TabKey) => {
    void lightHaptic();
    setActiveTabKey(key);
  };

  /** Jumping into a tab from elsewhere on the page (hero badge, a CTA) does
   *  scroll, otherwise the pane you asked for opens off-screen. */
  const goToTab = (key: TabKey) => {
    selectTab(key);
    scrollRef.current?.scrollTo({ y: heroHeightRef.current, animated: true });
  };

  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.screenScroll}
        contentContainerStyle={[
          styles.screenScrollContent,
          // Clear the docked bar (button + a two-line hint at worst) so the
          // last card is never trapped behind it.
          primaryAction ? { paddingBottom: 120 + insets.bottom } : null,
        ]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Hero */}
        <View
          style={styles.heroFixed}
          onLayout={e => {
            heroHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          {/* Full-bleed banner: status and prize float on the image, the scrim
              carries the identity line. Mirrors the list card so tapping a card
              reads as it expanding, and keeps the fold free for the tabs. The
              description now lives at the top of the Details tab. */}
          <View style={styles.heroBanner}>
            <TournamentBanner logoUrl={tournament.logo_url} />
            <View style={styles.heroBannerTopRow}>
              {isLive ? (
                <LiveBadge
                  label={t('tournamentDetail.status.in_progress')}
                  isDark={isDark}
                  onImage
                />
              ) : (
                <StatusBadge status={tournament.status} colors={colors} t={t} onImage />
              )}
              {/* What the event is worth, both currencies together: cash in the
                  solid gold pill, Circuit Rallia points in the lighter one. */}
              <View style={styles.heroBannerBadges}>
                {prizeTopLabel ? (
                  <View style={styles.heroPrizeBadge}>
                    <Ionicons name="trophy" size={13} color={accent[900]} />
                    <Text size="xs" weight="semibold" color={accent[900]} numberOfLines={1}>
                      {prizeTopLabel}
                    </Text>
                  </View>
                ) : null}
                {showRankingChip && rankingHeadline ? (
                  <TouchableOpacity
                    onPress={() => goToTab('points')}
                    activeOpacity={0.7}
                    style={styles.heroPointsBadge}
                    accessibilityRole="button"
                    accessibilityLabel={t('tournamentDetail.tabs.points')}
                    testID="hero-ranking-banner"
                  >
                    <Ionicons name="ribbon" size={13} color={accent[700]} />
                    <Text size="xs" weight="semibold" color={accent[700]} numberOfLines={1}>
                      {t('tournamentList.rankingPoints').replace(
                        '{points}',
                        String(rankingHeadline.points)
                      )}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            {/* Scrim is deliberately shallow and light: it only has to carry two
                lines, and the text shadow does the rest of the legibility work,
                so the artwork stays visible. */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.68)']}
              locations={[0, 0.42, 1]}
              style={styles.heroScrim}
            >
              {/* One line: the 2.4:1 banner is a wide strip, so a two-line
                  title left almost no artwork visible. */}
              <Text
                size="2xl"
                weight="bold"
                lineHeight="tight"
                color="#ffffff"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {tournament.name}
              </Text>
              <Text
                size="sm"
                color="rgba(255,255,255,0.92)"
                numberOfLines={1}
                style={styles.scrimText}
              >
                {/* Dates + venue only: the organizer byline has its own row in
                    the Overview's Event info card and overflowed this line. */}
                {[
                  `${formatDate(tournament.start_date)} – ${formatDate(tournament.end_date)}`,
                  tournament.venue_name || tournament.city,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </LinearGradient>
          </View>

          {/* One chip row replaces the registered band and the chat button. The
              receipt keeps the row alive on its own once the player has withdrawn. */}
          {showRegisteredChip || !!chatConversationId || !!receiptUrl ? (
            <View style={styles.heroChipRow}>
              {showRegisteredChip ? (
                <HeroChip
                  icon="checkmark-circle"
                  tone="positive"
                  colors={colors}
                  label={
                    myActiveRegistration.status === 'pending'
                      ? isInvitePending || isInvitedPending
                        ? t('tournamentDetail.actions.invitePendingLabel')
                        : t('tournamentDetail.actions.registrationPendingLabel')
                      : myPartnerName
                        ? t('tournamentDetail.actions.registeredWithPartnerLabel').replace(
                            '{name}',
                            myPartnerName
                          )
                        : t('tournamentDetail.actions.registeredLabel')
                  }
                />
              ) : null}
              {chatConversationId ? (
                <HeroChip
                  icon="chatbubbles-outline"
                  tone="outline"
                  colors={colors}
                  onPress={handleOpenChat}
                  label={t('tournamentDetail.chat.open')}
                />
              ) : null}
              {receiptUrl ? (
                <HeroChip
                  icon="receipt-outline"
                  tone="outline"
                  colors={colors}
                  onPress={() => void Linking.openURL(receiptUrl)}
                  label={t('tournamentDetail.actions.viewReceipt')}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Sticky tab bar — scrollable underline tabs: each sized to its label
            and left-aligned, so any number of tabs scrolls cleanly */}
        <EventDetailTabBar
          tabs={tabs}
          currentKey={currentTabKey}
          onSelect={selectTab}
          colors={colors}
          testIDPrefix="tournament"
        />

        {/* ============================ OVERVIEW ============================ */}
        {currentTabKey === 'overview' && (
          <OverviewTab
            tournament={tournament}
            colors={colors}
            t={t}
            locale={locale}
            formatDate={formatDate}
            formatDeadline={formatDeadline}
            deadlineUrgent={deadlineUrgent}
            goToTab={goToTab}
            setPlayersSegment={setPlayersSegment}
            stepIndex={stepIndex}
            isLive={isLive}
            isFinished={isFinished}
            wasCancelled={wasCancelled}
            startTileLabel={startTileLabel}
            startTileValue={startTileValue}
            registeredCount={registeredCount}
            spotsLeft={spotsLeft}
            matchProgress={matchProgress}
            totalRounds={totalRounds}
            championName={championName}
            isDoubles={isDoubles}
            isOrganizer={isOrganizer}
            isInvitePending={isInvitePending}
            isInvitedPending={isInvitedPending}
            myActiveRegistration={myActiveRegistration}
            myBracketState={myBracketState}
            myNextMatch={myNextMatch}
            myNextMatchDeadline={myNextMatchDeadline}
            myOpponentLabel={myOpponentLabel}
            myMatchP1={myMatchP1}
            myMatchP2={myMatchP2}
            handleBracketMatchTap={handleBracketMatchTap}
            handleOpenRoundChat={handleOpenRoundChat}
            openRoundChat={openRoundChat}
            onWithdraw={onWithdraw}
            withdraw={withdraw}
            refundRegistration={refundRegistration}
            canPlayerShare={canPlayerShare}
            onInviteFriends={handleShareInviteLink}
            organizerName={organizerName}
            organizerRows={organizerRows}
            pendingRequestRows={pendingRequestRows}
            registeredParticipantPlayers={registeredParticipantPlayers}
            hasPlayersTab={hasPlayersTab}
            ratingRangeLabel={ratingRangeLabel}
            venueSecondaryLine={venueSecondaryLine}
            entryFeeLabel={entryFeeLabel}
            refundSummary={refundSummary}
          />
        )}

        {/* ============================ BRACKET ============================= */}
        {currentTabKey === 'bracket' && showBracketTab && (
          <BracketTab
            tournament={tournament}
            colors={colors}
            t={t}
            userId={userId}
            isOrganizer={isOrganizer}
            isPoolTournament={isPoolTournament}
            currentPhaseDeadline={currentPhaseDeadline}
            deadlineUrgent={deadlineUrgent}
            formatDeadline={formatDeadline}
            knockoutMatches={knockoutMatches}
            poolMatches={poolMatches}
            poolStandings={poolStandings}
            poolPhaseComplete={poolPhaseComplete}
            nameByRegId={nameByRegId}
            membersByRegId={membersByRegId}
            seedByRegId={seedByRegId}
            slotPlayersByRegId={slotPlayersByRegId}
            generateKnockout={generateKnockout}
            handleGenerateKnockout={handleGenerateKnockout}
            handleBracketMatchTap={handleBracketMatchTap}
            handleOrganizerOverride={handleOrganizerOverride}
            handleBracketPlayerPress={handleBracketPlayerPress}
          />
        )}

        {/* ============================ PLAYERS ============================= */}
        {currentTabKey === 'players' && showPlayersTab && (
          <PlayersTab
            tournament={tournament}
            colors={colors}
            t={t}
            userId={userId}
            formatDate={formatDate}
            playersSegmentTabs={playersSegmentTabs}
            activePlayersSegment={activePlayersSegment}
            registeredParticipantPlayers={registeredParticipantPlayers}
            pendingRequestRows={pendingRequestRows}
            invitedPendingRows={invitedPendingRows}
            adminActions={adminActions}
            canRemoveRegistrants={canRemoveRegistrants}
            canForfeitRegistrants={canForfeitRegistrants}
            setPlayersSegment={setPlayersSegment}
            handlePlayerPress={handlePlayerPress}
            handleInvitePlayers={handleInvitePlayers}
            handleApprovePress={handleApprovePress}
            handleRemovePress={handleRemovePress}
            handleRevokeInvite={handleRevokeInvite}
          />
        )}

        {/* ============================ DETAILS ============================= */}
        {currentTabKey === 'details' && (
          <DetailsTab
            tournament={tournament}
            colors={colors}
            t={t}
            formatDate={formatDate}
            ratingRangeLabel={ratingRangeLabel}
            hasVenueDetails={hasVenueDetails}
            venueSecondaryLine={venueSecondaryLine}
            poolFormatLabel={poolFormatLabel}
            goodToKnowLines={goodToKnowLines}
            showFeesSection={showFeesSection}
            entryFeeLabel={entryFeeLabel}
            playerPaysServiceFee={playerPaysServiceFee}
            feeTotalLabel={feeTotalLabel}
            refundSummary={refundSummary}
            prizePoolLabel={prizePoolLabel}
          />
        )}

        {/* ============================= POINTS ============================= */}
        {currentTabKey === 'points' && pointsLadder && (
          <PointsTab ladder={pointsLadder} isDoubles={isDoubles} colors={colors} t={t} />
        )}

        {/* ============================= RULES ============================== */}
        {currentTabKey === 'rules' && showRulesTab && (
          <RulesTab rulesLines={rulesLines} colors={colors} />
        )}
      </ScrollView>

      {/* Docked primary action — the one thing this viewer should do next, kept
          out of the scroll so it's reachable from any tab at any position. */}
      {primaryAction && (
        <View
          style={[
            styles.dockedBar,
            {
              backgroundColor: colors.cardBackground,
              borderTopColor: colors.border,
              paddingBottom: spacingPixels[3] + insets.bottom,
            },
          ]}
        >
          <TouchableOpacity
            onPress={primaryAction.onPress}
            disabled={primaryAction.disabled}
            activeOpacity={0.7}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary },
              primaryAction.disabled && styles.buttonDisabled,
            ]}
            accessibilityRole="button"
            testID={primaryAction.testID}
          >
            <Ionicons name={primaryAction.icon} size={20} color="#ffffff" />
            <Text size="base" weight="semibold" color="#ffffff">
              {primaryAction.label}
            </Text>
          </TouchableOpacity>
          {primaryAction.hint ? (
            <Text size="xs" color={colors.textMuted} numberOfLines={2} style={styles.dockedBarHint}>
              {primaryAction.hint}
            </Text>
          ) : null}
        </View>
      )}

      {/* Organizer admin overflow menu (anchored under the header "⋯") */}
      <Modal
        visible={showActionsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionsMenu(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setShowActionsMenu(false)}>
          <View
            style={[
              styles.menuCard,
              {
                top: insets.top + (Platform.OS === 'ios' ? 44 : 56),
                backgroundColor: colors.cardBackground,
                borderColor: colors.border,
              },
            ]}
          >
            {adminActions.canEdit && (
              <MenuItem
                icon="create-outline"
                label={t('tournamentDetail.actions.editDetails')}
                testID="menu-edit-details"
                onPress={() => {
                  setShowActionsMenu(false);
                  handleEditDetails();
                }}
                colors={colors}
              />
            )}
            {adminActions.canInvite && (
              <MenuItem
                icon="share-social-outline"
                label={t('tournamentDetail.actions.invitePlayers')}
                testID="menu-invite-players"
                showDivider={adminActions.canEdit}
                onPress={() => {
                  setShowActionsMenu(false);
                  handleInvitePlayers();
                }}
                colors={colors}
              />
            )}
            {adminActions.canShareLink && (
              <MenuItem
                icon="link-outline"
                label={t('tournamentDetail.actions.shareInviteLink')}
                testID="menu-share-invite-link"
                showDivider={adminActions.canEdit || adminActions.canInvite}
                onPress={() => {
                  setShowActionsMenu(false);
                  handleShareInviteLink();
                }}
                colors={colors}
              />
            )}
            {adminActions.canSetDeadlines && (
              <MenuItem
                icon="hourglass-outline"
                label={t('tournamentDetail.actions.setDeadlines')}
                testID="menu-set-deadlines"
                showDivider={
                  adminActions.canEdit || adminActions.canInvite || adminActions.canShareLink
                }
                onPress={() => {
                  setShowActionsMenu(false);
                  handleSetDeadlines();
                }}
                colors={colors}
              />
            )}
            {adminActions.canReopen && (
              <MenuItem
                icon="lock-open-outline"
                label={t('tournamentDetail.actions.reopenRegistration')}
                testID="menu-reopen-registration"
                showDivider={
                  adminActions.canEdit || adminActions.canInvite || adminActions.canShareLink
                }
                onPress={() => {
                  setShowActionsMenu(false);
                  onReopen();
                }}
                colors={colors}
              />
            )}
            {adminActions.canCancel && (
              <MenuItem
                icon="close-circle-outline"
                label={t('tournamentDetail.actions.cancelTournament')}
                testID="menu-cancel-tournament"
                destructive
                showDivider={adminActions.canEdit || adminActions.canInvite}
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  setShowCancelModal(true);
                }}
                colors={colors}
              />
            )}
            {adminActions.canUnarchive && (
              <MenuItem
                icon="arrow-undo-outline"
                label={t('tournamentDetail.actions.unarchiveTournament')}
                testID="menu-unarchive-tournament"
                onPress={() => {
                  setShowActionsMenu(false);
                  onUnarchive();
                }}
                colors={colors}
              />
            )}
            {adminActions.canArchive && (
              <MenuItem
                icon="archive-outline"
                label={t('tournamentDetail.actions.archiveTournament')}
                testID="menu-archive-tournament"
                showDivider={adminActions.canEdit || adminActions.canCancel}
                onPress={() => {
                  setShowActionsMenu(false);
                  lightHaptic();
                  setShowArchiveModal(true);
                }}
                colors={colors}
              />
            )}
          </View>
        </Pressable>
      </Modal>

      <ConfirmationModal
        visible={showCancelModal && !!tournament}
        title={t('tournamentDetail.cancelModal.title')}
        message={
          // Cancelling a paid event refunds every entry; say so with the real
          // numbers instead of letting the organizer confirm a silent refund.
          isPaidTournament && (earnings?.paidCount ?? 0) > 0
            ? `${t('tournamentDetail.cancelModal.description')}\n\n${t(
                'tournamentDetail.cancelModal.paidRefundWarning'
              )
                .replace('{count}', String(earnings?.paidCount ?? 0))
                .replace(
                  '{amount}',
                  formatPrice(earnings?.entryCents ?? 0, earnings?.currency ?? 'CAD', { locale })
                )}`
            : t('tournamentDetail.cancelModal.description')
        }
        confirmLabel={t('tournamentDetail.cancelModal.confirm')}
        cancelLabel={t('tournamentDetail.cancelModal.keepIt')}
        confirmTestID="confirm-cancel-tournament"
        destructive
        isLoading={cancel.isPending}
        onClose={() => {
          setShowCancelModal(false);
          setCancelReason('');
        }}
        onConfirm={() => {
          if (!tournament) return;
          cancel.mutate({
            tournamentId: tournament.id,
            reason: cancelReason.trim(),
            versionWas: tournament.version,
          });
        }}
        extraContent={
          <TextInput
            style={[
              styles.reasonInput,
              {
                backgroundColor: colors.statusMutedBg,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            placeholder={t('tournamentDetail.cancelModal.reasonPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={cancelReason}
            onChangeText={setCancelReason}
            multiline
            maxLength={300}
            editable={!cancel.isPending}
          />
        }
      />

      <ConfirmationModal
        visible={showArchiveModal && !!tournament}
        title={t('tournamentDetail.archiveModal.title')}
        message={t('tournamentDetail.archiveModal.description')}
        confirmLabel={t('tournamentDetail.archiveModal.confirm')}
        cancelLabel={t('tournamentDetail.archiveModal.keepIt')}
        confirmTestID="confirm-archive-tournament"
        isLoading={archive.isPending}
        onClose={() => setShowArchiveModal(false)}
        onConfirm={() => {
          if (!tournament) return;
          archive.mutate({ tournamentId: tournament.id, versionWas: tournament.version });
        }}
      />

      <ConfirmationModal
        visible={!!removeTarget && !!tournament}
        title={t(`tournamentDetail.${removeModalCopy}.title`)}
        message={t(removeModalMessageKey, {
          name: removeTarget ? getHumanName(removeTarget, '') : '',
        })}
        confirmLabel={t(`tournamentDetail.${removeModalCopy}.confirm`)}
        cancelLabel={t(`tournamentDetail.${removeModalCopy}.keepIt`)}
        destructive
        isLoading={removeRegistrant.isPending || forfeitRegistrant.isPending}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />
    </SafeAreaView>
  );
};

const MenuItem: React.FC<{
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  showDivider?: boolean;
  colors: ScreenColors;
  testID?: string;
}> = ({ label, icon, onPress, destructive, showDivider, colors, testID }) => {
  const fg = destructive ? colors.danger : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      testID={testID}
      style={[
        styles.menuItem,
        showDivider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={fg} />
      <Text size="base" weight="medium" color={fg}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export default TournamentDetail;
