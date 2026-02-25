/**
 * AdminUserDetailScreen
 *
 * Detailed admin view of a single user, including:
 * - Profile information
 * - Sport profiles and ratings
 * - Match history summary
 * - Ban history
 * - Admin actions (ban/unban, etc.)
 *
 * Access Requirements:
 * - User must have admin role with 'support' or higher level
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '@rallia/shared-components';
import { Logger, banUser, unbanUser, updatePlayerProfile } from '@rallia/shared-services';
import type { EditableProfileFields } from '@rallia/shared-services';
import {
  useTheme,
  useAdminUserDetail,
  useAdminStatus,
  hasMinimumRole,
  type AdminUserDetail,
  type AdminSportProfile,
  type AdminMatchSummary,
  type AdminBanInfo,
} from '@rallia/shared-hooks';
import { useTranslation, useAuth } from '../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import type { RootStackParamList } from '../navigation/types';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';

type RouteParams = RouteProp<RootStackParamList, 'AdminUserDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const BASE_WHITE = '#ffffff';
const DEFAULT_AVATAR = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

// =============================================================================
// COMPONENT
// =============================================================================

const AdminUserDetailScreen: React.FC = () => {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { session } = useAuth();
  const isDark = theme === 'dark';
  const { isAdmin, role } = useAdminStatus();
  const { userId } = route.params;

  // State
  const [actionLoading, setActionLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedProfile, setEditedProfile] = useState<Partial<EditableProfileFields>>({});
  const [saveLoading, setSaveLoading] = useState(false);

  // Fetch user detail
  const { user, loading, error, refetch } = useAdminUserDetail(userId);

  // Theme-aware colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,
      accent: isDark ? primary[500] : primary[600],
      accentLight: isDark ? `${primary[500]}20` : `${primary[600]}10`,
      successBg: isDark ? `${status.success.DEFAULT}20` : `${status.success.light}15`,
      successText: status.success.DEFAULT,
      warningBg: isDark ? `${status.warning.DEFAULT}20` : `${status.warning.light}15`,
      warningText: status.warning.DEFAULT,
      errorBg: isDark ? `${status.error.DEFAULT}20` : `${status.error.light}15`,
      errorText: status.error.DEFAULT,
    }),
    [themeColors, isDark]
  );

  // Access check
  const hasAccess = isAdmin && hasMinimumRole(role, 'support');
  const canBan = isAdmin && hasMinimumRole(role, 'moderator');
  const canEdit = isAdmin && hasMinimumRole(role, 'moderator');

  // Start edit mode
  const handleStartEdit = useCallback(() => {
    if (!user || !canEdit) return;
    lightHaptic();
    setEditedProfile({
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      display_name: user.display_name || '',
      email: user.email || '',
      phone: user.phone_number || '',
      bio: '', // bio not available on AdminUserDetail
      city: user.city || '',
      country: user.country || '',
      gender: user.gender || '',
      birth_date: user.date_of_birth || '',
    });
    setIsEditing(true);
  }, [user, canEdit]);

  // Cancel edit mode
  const handleCancelEdit = useCallback(() => {
    lightHaptic();
    setIsEditing(false);
    setEditedProfile({});
  }, []);

  // Save profile changes
  const handleSaveProfile = useCallback(async () => {
    if (!user || !session?.user?.id || !canEdit) return;

    // Filter out unchanged fields
    const changes: Partial<EditableProfileFields> = {};
    if (editedProfile.first_name !== (user.first_name || '')) changes.first_name = editedProfile.first_name;
    if (editedProfile.last_name !== (user.last_name || '')) changes.last_name = editedProfile.last_name;
    if (editedProfile.display_name !== (user.display_name || '')) changes.display_name = editedProfile.display_name;
    if (editedProfile.email !== (user.email || '')) changes.email = editedProfile.email;
    if (editedProfile.phone !== (user.phone_number || '')) changes.phone = editedProfile.phone;
    if (editedProfile.bio) changes.bio = editedProfile.bio; // bio can be set even if not visible
    if (editedProfile.city !== (user.city || '')) changes.city = editedProfile.city;
    if (editedProfile.country !== (user.country || '')) changes.country = editedProfile.country;
    if (editedProfile.gender !== (user.gender || '')) changes.gender = editedProfile.gender;
    if (editedProfile.birth_date !== (user.date_of_birth || '')) changes.birth_date = editedProfile.birth_date;

    if (Object.keys(changes).length === 0) {
      Alert.alert(
        t('common.info' as TranslationKey),
        t('admin.users.edit.noChanges' as TranslationKey)
      );
      return;
    }

    try {
      mediumHaptic();
      setSaveLoading(true);
      await updatePlayerProfile(user.id, session.user.id, changes as EditableProfileFields);
      Logger.logUserAction('admin_profile_edited', { 
        userId: user.id, 
        fields: Object.keys(changes) 
      });
      await refetch();
      setIsEditing(false);
      setEditedProfile({});
      Alert.alert(
        t('common.done'),
        t('admin.users.edit.saveSuccess' as TranslationKey)
      );
    } catch (err) {
      console.error('Failed to save profile:', err);
      Alert.alert(
        t('common.error'),
        t('admin.users.edit.saveFailed' as TranslationKey)
      );
    } finally {
      setSaveLoading(false);
    }
  }, [user, session, canEdit, editedProfile, t, refetch]);

  // Update edited field
  const updateEditField = useCallback((field: keyof EditableProfileFields, value: string) => {
    setEditedProfile((prev: Partial<EditableProfileFields>) => ({ ...prev, [field]: value }));
  }, []);

  // Get user display name
  const getUserDisplayName = useCallback((userInfo: AdminUserDetail | null): string => {
    if (!userInfo) return '';
    if (userInfo.display_name) return userInfo.display_name;
    if (userInfo.first_name || userInfo.last_name) {
      return `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim();
    }
    return t('admin.users.anonymous' as TranslationKey);
  }, [t]);

  // Format date
  const formatDate = useCallback((dateString: string | null): string => {
    if (!dateString) return t('common.never' as TranslationKey);
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [t]);

  // Handle ban user
  const handleBanUser = useCallback(async () => {
    if (!user || !session?.user?.id || !canBan) return;

    Alert.alert(
      t('admin.users.actions.banUser' as TranslationKey),
      t('admin.users.actions.banConfirm' as TranslationKey, { name: getUserDisplayName(user) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.users.actions.ban' as TranslationKey),
          style: 'destructive',
          onPress: async () => {
            try {
              mediumHaptic();
              setActionLoading(true);
              await banUser({
                playerId: user.id,
                adminId: session.user.id,
                reason: 'Banned by admin', // TODO: Add reason input modal
                banType: 'permanent',
              });
              Logger.logUserAction('admin_user_banned', { userId: user.id });
              await refetch();
              Alert.alert(
                t('common.done'),
                t('admin.users.actions.banSuccess' as TranslationKey)
              );
            } catch (err) {
              console.error('Failed to ban user:', err);
              Alert.alert(
                t('common.error'),
                t('admin.users.actions.banFailed' as TranslationKey)
              );
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }, [user, session, canBan, t, refetch, getUserDisplayName]);

  // Handle unban user
  const handleUnbanUser = useCallback(async () => {
    if (!user || !session?.user?.id || !canBan || !user.active_ban) return;

    Alert.alert(
      t('admin.users.actions.unbanUser' as TranslationKey),
      t('admin.users.actions.unbanConfirm' as TranslationKey, { name: getUserDisplayName(user) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.users.actions.unban' as TranslationKey),
          onPress: async () => {
            try {
              mediumHaptic();
              setActionLoading(true);
              await unbanUser(user.active_ban!.id, session.user.id);
              Logger.logUserAction('admin_user_unbanned', { userId: user.id });
              await refetch();
              Alert.alert(
                t('common.done'),
                t('admin.users.actions.unbanSuccess' as TranslationKey)
              );
            } catch (err) {
              console.error('Failed to unban user:', err);
              Alert.alert(
                t('common.error'),
                t('admin.users.actions.unbanFailed' as TranslationKey)
              );
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }, [user, session, canBan, t, refetch, getUserDisplayName]);

  // Handle view profile
  const handleViewProfile = useCallback(() => {
    if (!user) return;
    lightHaptic();
    navigation.navigate('UserProfile', { userId: user.id });
  }, [user, navigation]);

  // Render status badge
  const renderStatusBadge = () => {
    if (!user) return null;

    if (user.active_ban) {
      return (
        <View style={[styles.statusBadgeLarge, { backgroundColor: colors.errorBg }]}>
          <Ionicons name="ban-outline" size={16} color={colors.errorText} />
          <Text size="sm" weight="semibold" color={colors.errorText}>
            {t('admin.users.status.banned' as TranslationKey)}
          </Text>
        </View>
      );
    }
    if (!user.is_active) {
      return (
        <View style={[styles.statusBadgeLarge, { backgroundColor: colors.warningBg }]}>
          <Ionicons name="time-outline" size={16} color={colors.warningText} />
          <Text size="sm" weight="semibold" color={colors.warningText}>
            {t('admin.users.status.inactive' as TranslationKey)}
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.statusBadgeLarge, { backgroundColor: colors.successBg }]}>
        <Ionicons name="checkmark-circle-outline" size={16} color={colors.successText} />
        <Text size="sm" weight="semibold" color={colors.successText}>
          {t('admin.users.status.active' as TranslationKey)}
        </Text>
      </View>
    );
  };

  // Render info row
  const renderInfoRow = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    value: string | null
  ) => (
    <View style={styles.infoRow}>
      <View style={styles.infoLabel}>
        <Ionicons name={icon} size={18} color={colors.textMuted} />
        <Text size="sm" color={colors.textMuted}>
          {label}
        </Text>
      </View>
      <Text size="sm" color={colors.text} style={styles.infoValue}>
        {value || '-'}
      </Text>
    </View>
  );

  // Render editable field
  const renderEditableField = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    field: keyof EditableProfileFields,
    placeholder: string,
    multiline: boolean = false
  ) => (
    <View style={styles.editFieldContainer}>
      <View style={styles.editFieldLabel}>
        <Ionicons name={icon} size={18} color={colors.textMuted} />
        <Text size="sm" color={colors.textMuted}>
          {label}
        </Text>
      </View>
      <TextInput
        style={[
          styles.editFieldInput,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            color: colors.text,
          },
          multiline && styles.editFieldMultiline,
        ]}
        value={editedProfile[field] || ''}
        onChangeText={(value) => updateEditField(field, value)}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );

  // Render sport profile card
  const renderSportProfile = (profile: AdminSportProfile) => (
    <View
      key={profile.id}
      style={[styles.sportCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      <View style={styles.sportHeader}>
        <Text size="base" weight="semibold" color={colors.text}>
          {profile.sport_name}
        </Text>
        {profile.is_verified && (
          <View style={[styles.verifiedBadge, { backgroundColor: colors.successBg }]}>
            <Ionicons name="checkmark-circle" size={12} color={colors.successText} />
            <Text size="xs" color={colors.successText}>
              {t('common.verified')}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.sportDetails}>
        {profile.skill_level !== null && (
          <Text size="sm" color={colors.textSecondary}>
            {t('admin.users.skillLevel' as TranslationKey)}: {profile.skill_level}
          </Text>
        )}
        {profile.rating_label && (
          <Text size="sm" color={colors.textSecondary}>
            {t('admin.users.rating' as TranslationKey)}: {profile.rating_label}
          </Text>
        )}
      </View>
      <Text size="xs" color={colors.textMuted}>
        {t('admin.users.created' as TranslationKey)}: {formatDate(profile.created_at)}
      </Text>
    </View>
  );

  // Render match summary card
  const renderMatchSummary = (match: AdminMatchSummary) => (
    <View
      key={match.id}
      style={[styles.matchCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
    >
      <View style={styles.matchHeader}>
        <Text size="sm" weight="semibold" color={colors.text}>
          {match.sport_name}
        </Text>
        <View
          style={[
            styles.matchStatusBadge,
            {
              backgroundColor:
                match.status === 'completed'
                  ? colors.successBg
                  : match.status === 'cancelled'
                  ? colors.errorBg
                  : colors.accentLight,
            },
          ]}
        >
          <Text
            size="xs"
            color={
              match.status === 'completed'
                ? colors.successText
                : match.status === 'cancelled'
                ? colors.errorText
                : colors.accent
            }
          >
            {match.status}
          </Text>
        </View>
      </View>
      <Text size="xs" color={colors.textMuted}>
        {match.match_type} • {match.participant_count} {t('admin.users.participants' as TranslationKey)}
      </Text>
      <Text size="xs" color={colors.textMuted}>
        {formatDate(match.scheduled_at)}
      </Text>
    </View>
  );

  // Render ban history item
  const renderBanHistoryItem = (ban: AdminBanInfo) => (
    <View
      key={ban.id}
      style={[styles.banCard, { backgroundColor: colors.errorBg, borderColor: colors.border }]}
    >
      <View style={styles.banHeader}>
        <View style={styles.banType}>
          <Ionicons name="ban-outline" size={16} color={colors.errorText} />
          <Text size="sm" weight="semibold" color={colors.errorText}>
            {ban.ban_type === 'permanent'
              ? t('admin.users.banType.permanent' as TranslationKey)
              : t('admin.users.banType.temporary' as TranslationKey)}
          </Text>
        </View>
        <View
          style={[
            styles.banStatusBadge,
            { backgroundColor: ban.is_active ? colors.errorBg : colors.successBg },
          ]}
        >
          <Text size="xs" color={ban.is_active ? colors.errorText : colors.successText}>
            {ban.is_active
              ? t('admin.users.status.active' as TranslationKey)
              : t('admin.users.banStatus.lifted' as TranslationKey)}
          </Text>
        </View>
      </View>
      <Text size="sm" color={colors.text} style={styles.banReason}>
        {ban.reason}
      </Text>
      {ban.notes && (
        <Text size="xs" color={colors.textMuted} style={styles.banNotes}>
          {ban.notes}
        </Text>
      )}
      <View style={styles.banDates}>
        <Text size="xs" color={colors.textMuted}>
          {t('admin.users.bannedAt' as TranslationKey)}: {formatDate(ban.banned_at)}
        </Text>
        {ban.expires_at && (
          <Text size="xs" color={colors.textMuted}>
            {t('admin.users.expiresAt' as TranslationKey)}: {formatDate(ban.expires_at)}
          </Text>
        )}
      </View>
    </View>
  );

  // Access denied view
  if (!hasAccess) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={styles.centerContent}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.centerTitle}>
            {t('admin.errors.accessDenied' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centerDescription}>
            {t('admin.errors.noPermission' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Loading view
  if (loading && !user) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text size="sm" color={colors.textMuted} style={styles.centerTitle}>
            {t('common.loading')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error view
  if (error && !user) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={styles.centerContent}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.centerTitle}>
            {t('admin.errors.loadFailed' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.centerDescription}>
            {error.message}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={() => refetch()}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={18} color={BASE_WHITE} />
            <Text size="sm" weight="semibold" color={BASE_WHITE}>
              {t('common.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!user) return null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />
        }
      >
        {/* Profile Header */}
        <View style={[styles.profileHeader, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
          <Image
            source={{ uri: user.profile_picture_url || DEFAULT_AVATAR }}
            style={styles.profileAvatar}
          />
          <View style={styles.profileInfo}>
            <Text size="xl" weight="bold" color={colors.text}>
              {getUserDisplayName(user)}
            </Text>
            <Text size="sm" color={colors.textSecondary}>
              {user.email || t('admin.users.noEmail' as TranslationKey)}
            </Text>
            {renderStatusBadge()}
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.accentLight }]}
            onPress={handleViewProfile}
            activeOpacity={0.7}
          >
            <Ionicons name="person-outline" size={20} color={colors.accent} />
            <Text size="sm" weight="medium" color={colors.accent}>
              {t('admin.users.actions.viewProfile' as TranslationKey)}
            </Text>
          </TouchableOpacity>

          {canEdit && !isEditing && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.accentLight }]}
              onPress={handleStartEdit}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={20} color={colors.accent} />
              <Text size="sm" weight="medium" color={colors.accent}>
                {t('admin.users.actions.edit' as TranslationKey)}
              </Text>
            </TouchableOpacity>
          )}

          {canBan && !isEditing && (
            <>
              {user.active_ban ? (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.successBg }]}
                  onPress={handleUnbanUser}
                  disabled={actionLoading}
                  activeOpacity={0.7}
                >
                  {actionLoading ? (
                    <ActivityIndicator size="small" color={colors.successText} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={20} color={colors.successText} />
                      <Text size="sm" weight="medium" color={colors.successText}>
                        {t('admin.users.actions.unban' as TranslationKey)}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.errorBg }]}
                  onPress={handleBanUser}
                  disabled={actionLoading}
                  activeOpacity={0.7}
                >
                  {actionLoading ? (
                    <ActivityIndicator size="small" color={colors.errorText} />
                  ) : (
                    <>
                      <Ionicons name="ban-outline" size={20} color={colors.errorText} />
                      <Text size="sm" weight="medium" color={colors.errorText}>
                        {t('admin.users.actions.ban' as TranslationKey)}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Edit Mode */}
        {isEditing ? (
          <View style={[styles.section, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <View style={styles.editHeader}>
              <Text size="base" weight="semibold" color={colors.text}>
                {t('admin.users.edit.title' as TranslationKey)}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {t('admin.users.edit.description' as TranslationKey)}
              </Text>
            </View>
            
            {renderEditableField('person-outline', t('admin.users.edit.firstName' as TranslationKey), 'first_name', t('admin.users.edit.firstNamePlaceholder' as TranslationKey))}
            {renderEditableField('person-outline', t('admin.users.edit.lastName' as TranslationKey), 'last_name', t('admin.users.edit.lastNamePlaceholder' as TranslationKey))}
            {renderEditableField('at-outline', t('admin.users.edit.displayName' as TranslationKey), 'display_name', t('admin.users.edit.displayNamePlaceholder' as TranslationKey))}
            {renderEditableField('mail-outline', t('admin.users.edit.email' as TranslationKey), 'email', t('admin.users.edit.emailPlaceholder' as TranslationKey))}
            {renderEditableField('call-outline', t('admin.users.edit.phone' as TranslationKey), 'phone', t('admin.users.edit.phonePlaceholder' as TranslationKey))}
            {renderEditableField('document-text-outline', t('admin.users.edit.bio' as TranslationKey), 'bio', t('admin.users.edit.bioPlaceholder' as TranslationKey), true)}
            {renderEditableField('location-outline', t('admin.users.edit.city' as TranslationKey), 'city', t('admin.users.edit.cityPlaceholder' as TranslationKey))}
            {renderEditableField('globe-outline', t('admin.users.edit.country' as TranslationKey), 'country', t('admin.users.edit.countryPlaceholder' as TranslationKey))}
            {renderEditableField('male-female-outline', t('admin.users.edit.gender' as TranslationKey), 'gender', t('admin.users.edit.genderPlaceholder' as TranslationKey))}
            {renderEditableField('calendar-outline', t('admin.users.edit.dateOfBirth' as TranslationKey), 'birth_date', 'YYYY-MM-DD')}

            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.editActionButton, { backgroundColor: colors.errorBg }]}
                onPress={handleCancelEdit}
                disabled={saveLoading}
                activeOpacity={0.7}
              >
                <Ionicons name="close-outline" size={20} color={colors.errorText} />
                <Text size="sm" weight="semibold" color={colors.errorText}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.editActionButton, { backgroundColor: colors.accent }]}
                onPress={handleSaveProfile}
                disabled={saveLoading}
                activeOpacity={0.7}
              >
                {saveLoading ? (
                  <ActivityIndicator size="small" color={BASE_WHITE} />
                ) : (
                  <>
                    <Ionicons name="checkmark-outline" size={20} color={BASE_WHITE} />
                    <Text size="sm" weight="semibold" color={BASE_WHITE}>
                      {t('common.save')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* User Information Section */
          <View style={[styles.section, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
              {t('admin.users.sections.userInfo' as TranslationKey)}
            </Text>
            {renderInfoRow('mail-outline', t('admin.users.info.email' as TranslationKey), user.email)}
            {renderInfoRow('call-outline', t('admin.users.info.phone' as TranslationKey), user.phone_number)}
            {renderInfoRow('location-outline', t('admin.users.info.location' as TranslationKey), 
              user.city && user.country ? `${user.city}, ${user.country}` : user.city || user.country)}
            {renderInfoRow('male-female-outline', t('admin.users.info.gender' as TranslationKey), user.gender)}
            {renderInfoRow('calendar-outline', t('admin.users.info.birthDate' as TranslationKey), 
              user.date_of_birth ? formatDate(user.date_of_birth) : null)}
            {renderInfoRow('hand-left-outline', t('admin.users.info.playingHand' as TranslationKey), user.playing_hand)}
          </View>
        )}

        {/* Account Information Section */}
        <View style={[styles.section, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
          <Text size="base" weight="semibold" color={colors.text} style={styles.sectionTitle}>
            {t('admin.users.sections.accountInfo' as TranslationKey)}
          </Text>
          {renderInfoRow('log-in-outline', t('admin.users.info.lastLogin' as TranslationKey), formatDate(user.last_sign_in_at))}
          {renderInfoRow('time-outline', t('admin.users.info.createdAt' as TranslationKey), formatDate(user.created_at))}
          {renderInfoRow('create-outline', t('admin.users.info.updatedAt' as TranslationKey), formatDate(user.updated_at))}
          {renderInfoRow('checkmark-done-outline', t('admin.users.info.onboardingCompleted' as TranslationKey), 
            user.onboarding_completed ? t('common.yes') : t('common.no'))}
        </View>

        {/* Sport Profiles Section */}
        {user.sport_profiles && user.sport_profiles.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionHeader}>
              {t('admin.users.sections.sportProfiles' as TranslationKey)} ({user.sport_profiles.length})
            </Text>
            {user.sport_profiles.map(renderSportProfile)}
          </View>
        )}

        {/* Recent Matches Section */}
        {user.recent_matches && user.recent_matches.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionHeader}>
              {t('admin.users.sections.recentMatches' as TranslationKey)} ({user.recent_matches.length})
            </Text>
            {user.recent_matches.map(renderMatchSummary)}
          </View>
        )}

        {/* Ban History Section */}
        {user.ban_history && user.ban_history.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text size="base" weight="semibold" color={colors.text} style={styles.sectionHeader}>
              {t('admin.users.sections.banHistory' as TranslationKey)} ({user.ban_history.length})
            </Text>
            {user.ban_history.map(renderBanHistoryItem)}
          </View>
        )}

        {/* Footer Spacing */}
        <View style={styles.footerSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[6],
  },
  centerTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  centerDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[4],
    gap: spacingPixels[2],
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[4],
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  profileInfo: {
    flex: 1,
    gap: spacingPixels[1],
  },
  statusBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    marginTop: spacingPixels[2],
    gap: spacingPixels[1],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    marginTop: spacingPixels[4],
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  section: {
    marginTop: spacingPixels[4],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    marginBottom: spacingPixels[3],
  },
  sectionContainer: {
    marginTop: spacingPixels[4],
  },
  sectionHeader: {
    marginBottom: spacingPixels[3],
    paddingHorizontal: spacingPixels[1],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  infoLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
  },
  sportCard: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacingPixels[2],
  },
  sportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    gap: spacingPixels[1],
  },
  sportDetails: {
    gap: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },
  matchCard: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacingPixels[2],
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[1],
  },
  matchStatusBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  banCard: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacingPixels[2],
  },
  banHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  banType: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  banStatusBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  banReason: {
    marginBottom: spacingPixels[2],
  },
  banNotes: {
    fontStyle: 'italic',
    marginBottom: spacingPixels[2],
  },
  banDates: {
    gap: spacingPixels[1],
  },
  footerSpacer: {
    height: spacingPixels[8],
  },
  // Edit mode styles
  editHeader: {
    marginBottom: spacingPixels[4],
    gap: spacingPixels[1],
  },
  editFieldContainer: {
    marginBottom: spacingPixels[3],
  },
  editFieldLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  editFieldInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    fontSize: 14,
  },
  editFieldMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    marginTop: spacingPixels[4],
    paddingTop: spacingPixels[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  editActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});

export default AdminUserDetailScreen;
