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

import type { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import type { RootStackParamList } from './types';

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
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes,
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

      // Admin screens - protected by useAdminDeepLinkGuard
      AdminPanel: 'admin',
      AdminDashboard: 'admin/dashboard',
      AdminUsers: 'admin/users',
      AdminUserDetail: 'admin/users/:userId',
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
    default:
      path = route.toLowerCase();
  }

  return Linking.createURL(path);
}

export default linking;
