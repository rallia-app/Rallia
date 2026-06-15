/**
 * Navigation Linking Configuration
 *
 * Configures deep linking for the application.
 * Supports both rallia:// URL scheme and https://rallia.app universal links.
 *
 * Security Note:
 * Admin routes are protected by the useAdminDeepLinkGuard hook which verifies
 * admin status before allowing navigation to admin screens.
 */

import { type LinkingOptions, getStateFromPath } from '@react-navigation/native';
import * as Linking from 'expo-linking';

import type { RootStackParamList } from './types';
import {
  setPendingDeepLink,
  isSportSelectionComplete,
  type DeepLinkPayload,
} from './deepLinkStore';

/** Known locale prefixes used by the web app (next-intl) */
const LOCALE_PATTERN = /^\/(en|en-US|fr|fr-CA|fr-FR)\//;

// =============================================================================
// URL PREFIXES
// =============================================================================

const prefixes = [
  Linking.createURL('/'), // rallia://
  'https://rallia.app',
  'https://www.rallia.app',
];

// =============================================================================
// SCREEN CONFIGURATION
// =============================================================================

/**
 * Linking configuration for React Navigation
 * Maps URL paths to screen names and parameters
 */
/**
 * Try to extract a deep link payload from the URL path.
 * Returns the payload if matched, or null to fall through to default routing.
 */
function extractDeepLinkPayload(path: string): DeepLinkPayload | null {
  // /community/join/:inviteCode (must be checked before /community/:communityId)
  const communityJoin = path.match(/^\/community\/join\/([A-Za-z0-9]+)/);
  if (communityJoin) {
    return { type: 'community', inviteCode: communityJoin[1] };
  }

  // /join/:inviteCode — group invite
  const groupJoin = path.match(/^\/join\/([A-Za-z0-9]+)/);
  if (groupJoin) {
    return { type: 'group', inviteCode: groupJoin[1] };
  }

  // /match/:matchId
  const matchLink = path.match(/^\/match\/([A-Za-z0-9-]+)/);
  if (matchLink) {
    return { type: 'match', matchId: matchLink[1] };
  }

  // /games — browse public matches
  if (path === '/games' || path.startsWith('/games?')) {
    return { type: 'publicMatches' };
  }

  // /suggestions — open matchup suggestions sheet
  if (path === '/suggestions' || path.startsWith('/suggestions?')) {
    return { type: 'matchupSuggestions' };
  }

  // /match-invite/confirm — opens the one-tap email-invite confirmation sheet.
  // Sent by the morning digest email; query params carry the picked slot.
  if (path === '/match-invite/confirm' || path.startsWith('/match-invite/confirm?')) {
    const queryMatch = path.match(/\?(.*)/);
    const params = new URLSearchParams(queryMatch?.[1] ?? '');
    const opponentId = params.get('opponent') ?? undefined;
    const facilityId = params.get('facility') ?? undefined;
    const sportId = params.get('sport') ?? undefined;
    const matchDate = params.get('date') ?? undefined;
    const startTime = params.get('start_time') ?? undefined;
    const endTime = params.get('end_time') ?? undefined;
    if (opponentId && facilityId && sportId && matchDate && startTime && endTime) {
      return {
        type: 'matchInviteConfirm',
        opponentId,
        facilityId,
        sportId,
        matchDate,
        startTime,
        endTime,
      };
    }
    // Missing/invalid params → fall through to the generic suggestions sheet.
    return { type: 'matchupSuggestions' };
  }

  // /invite/:referralCode?type=...&id=...&share=...
  const inviteLink = path.match(/^\/invite\/([A-Za-z0-9]+)/);
  if (inviteLink) {
    const referralCode = inviteLink[1];
    // Parse query params
    const queryMatch = path.match(/\?(.*)/);
    const params = new URLSearchParams(queryMatch?.[1] ?? '');
    const type = params.get('type') ?? undefined;
    const id = params.get('id') ?? undefined;
    const share = params.get('share') ?? undefined;
    const validTypes = ['match', 'group', 'community', 'tournament', 'referral'] as const;
    const invitationType =
      type && validTypes.includes(type as (typeof validTypes)[number])
        ? (type as (typeof validTypes)[number])
        : undefined;
    return {
      type: 'invitation' as const,
      referralCode,
      invitationType,
      targetId: id,
      shareToken: share,
    };
  }

  return null;
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes,
  // Strip locale prefixes and intercept deep link URLs before default routing
  getStateFromPath(path, options) {
    const cleaned = path.replace(LOCALE_PATTERN, '/');

    // Check for deep link patterns — store the data and navigate to Main
    const payload = extractDeepLinkPayload(cleaned);
    if (payload) {
      setPendingDeepLink(payload);
      const destination = isSportSelectionComplete() ? 'Main' : 'PreOnboarding';
      return { routes: [{ name: destination }] };
    }

    return getStateFromPath(cleaned, options);
  },
  config: {
    screens: {
      // Main app entry
      Main: {
        path: '',
        screens: {
          Home: {
            path: 'home',
            screens: {
              HomeScreen: '',
              PlayerMatches: 'matches',
              PublicMatches: 'public-matches',
            },
          },
          Courts: {
            path: 'courts',
            screens: {
              FacilitiesDirectory: '',
              FacilityDetail: ':facilityId',
            },
          },
          Community: {
            path: 'community',
            screens: {
              PlayerDirectory: 'players',
              Groups: 'groups',
              Communities: 'communities',
            },
          },
          Chat: {
            path: 'chat',
            screens: {
              Conversations: '',
              ChatScreen: ':conversationId',
            },
          },
        },
      },

      // Shared screens
      UserProfile: 'profile/:userId?',
      PlayerProfile: 'player/:playerId',
      SportProfile: 'sport/:sportId/:playerId?',
      Settings: 'settings',
      Notifications: 'notifications',
      NotificationPreferences: 'notifications/preferences',
      Map: 'map',
      ChatConversation: 'conversation/:conversationId',
      GroupDetail: 'group/:groupId',
      CommunityDetail: 'community/:communityId',
      InviteReferral: 'invite-legacy/:referralCode',

      // Weekly check-in wizard — deep link from the Monday push reminder.
      WeeklyCheckIn: 'weekly-checkin',

      // Admin screens - protected by useAdminDeepLinkGuard
      AdminPanel: 'admin',
      AdminDashboard: 'admin/dashboard',
      AdminUsers: 'admin/users',
      AdminUserDetail: 'admin/users/:userId',
      AdminNetworks: 'admin/networks',
      AdminNetworkDetail: 'admin/networks/:networkId',
      AdminModeration: 'admin/moderation',
      AdminAlerts: 'admin/alerts',
      AdminActivityLog: 'admin/activity',
      AdminSettings: 'admin/settings',
    },
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a URL is an admin route
 */
export function isAdminRoute(url: string): boolean {
  return url.includes('/admin');
}

/**
 * Extract route name from URL
 */
export function getRouteFromUrl(url: string): string | null {
  const cleanUrl = url.replace(/^(rallia:\/\/|https:\/\/(www\.)?rallia\.app\/)/, '');
  const parts = cleanUrl.split('/').filter(Boolean);
  return parts[0] || null;
}

/**
 * Generate a deep link URL for a given route
 */
export function generateDeepLink(
  route: keyof RootStackParamList,
  params?: Record<string, string>
): string {
  let path: string;

  switch (route) {
    case 'AdminPanel':
      path = 'admin';
      break;
    case 'AdminDashboard':
      path = 'admin/dashboard';
      break;
    case 'AdminUsers':
      path = 'admin/users';
      break;
    case 'AdminUserDetail':
      path = `admin/users/${params?.userId || ''}`;
      break;
    case 'AdminModeration':
      path = 'admin/moderation';
      break;
    case 'AdminAlerts':
      path = 'admin/alerts';
      break;
    case 'AdminActivityLog':
      path = 'admin/activity';
      break;
    case 'AdminSettings':
      path = 'admin/settings';
      break;
    case 'UserProfile':
      path = params?.userId ? `profile/${params.userId}` : 'profile';
      break;
    case 'PlayerProfile':
      path = `player/${params?.playerId || ''}`;
      break;
    case 'InviteReferral':
      path = `invite/${params?.referralCode || ''}`;
      break;
    default:
      path = route.toLowerCase();
  }

  return Linking.createURL(path);
}

export default linking;
