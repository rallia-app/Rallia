/**
 * AdminNetworkDetailScreen
 *
 * Detailed admin view of a network (group or community), including:
 * - Network information
 * - Member list
 * - Favorite facilities
 * - Certification controls (for communities only)
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';
import { Text, useToast } from '@rallia/shared-components';
import {
  useTheme,
  useAdminNetworkDetail,
  useCertifyNetwork,
  useDeleteNetwork,
  useAdminStatus,
  hasMinimumRole,
  type AdminNetworkMember,
  type AdminNetworkFacility,
} from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';
import type { TranslationKey } from '@rallia/shared-translations';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';

import { useTranslation } from '../hooks';
import type { RootStackParamList } from '../navigation/types';

type RouteParams = RouteProp<RootStackParamList, 'AdminNetworkDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const BASE_WHITE = '#ffffff';
const DEFAULT_COVER =
  'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=400&h=200&fit=crop';
const DEFAULT_AVATAR = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

// =============================================================================
// COMPONENT
// =============================================================================

const AdminNetworkDetailScreen: React.FC = () => {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const toast = useToast();
  const isDark = theme === 'dark';
  const { isAdmin, role } = useAdminStatus();
  const { networkId } = route.params;

  // State
  const [certificationNotes, setCertificationNotes] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [showMembersExpanded, setShowMembersExpanded] = useState(false);
  const [showFacilitiesExpanded, setShowFacilitiesExpanded] = useState(false);

  // Hooks
  const { network, loading, error, refetch } = useAdminNetworkDetail(networkId);
  const { certify, loading: certifyLoading } = useCertifyNetwork();
  const { deleteNetworkFn, loading: deleteLoading } = useDeleteNetwork();

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
      certifiedBg: isDark ? `${primary[500]}20` : `${primary[600]}10`,
      certifiedText: isDark ? primary[400] : primary[600],
      inputBackground: isDark ? neutral[800] : neutral[100],
    }),
    [themeColors, isDark]
  );

  // Access check
  const hasAccess = isAdmin && hasMinimumRole(role, 'support');
  const canCertify = isAdmin && hasMinimumRole(role, 'moderator');
  const canDelete = isAdmin && hasMinimumRole(role, 'moderator');

  // Is community?
  const isCommunity = network?.network_type === 'community';

  // Format date
  const formatDate = useCallback(
    (dateString: string | null): string => {
      if (!dateString) return t('common.never' as TranslationKey);
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [t]
  );

  // Handle certification toggle
  const handleCertificationToggle = useCallback(async () => {
    if (!network || !canCertify || certifyLoading) return;

    const newCertified = !network.is_certified;
    const actionKey = newCertified ? 'certify' : 'uncertify';

    Alert.alert(
      t(`admin.networks.certification.${actionKey}Title` as TranslationKey),
      t(`admin.networks.certification.${actionKey}Message` as TranslationKey),
      [
        {
          text: t('common.cancel' as TranslationKey),
          style: 'cancel',
        },
        {
          text: t('common.confirm' as TranslationKey),
          onPress: async () => {
            try {
              mediumHaptic();
              const result = await certify(
                network.id,
                newCertified,
                certificationNotes.trim() || undefined
              );

              if (result.success) {
                Logger.logUserAction('admin_network_certification_changed', {
                  networkId: network.id,
                  isCertified: newCertified,
                });
                toast.success(
                  t(`admin.networks.certification.${actionKey}Success` as TranslationKey)
                );
                setCertificationNotes('');
                refetch();
              } else {
                toast.error(result.error || t('common.error' as TranslationKey));
              }
            } catch (err) {
              console.error('Certification error:', err);
              toast.error(t('common.error' as TranslationKey));
            }
          },
        },
      ]
    );
  }, [network, canCertify, certifyLoading, certificationNotes, certify, t, toast, refetch]);

  // Handle network deletion
  const handleDeleteNetwork = useCallback(() => {
    if (!network || !canDelete || deleteLoading) return;

    const networkType = network.network_type === 'player_group' ? 'group' : 'community';
    const memberCount = network.member_count || 0;

    Alert.alert(
      t('admin.networks.delete.title' as TranslationKey),
      t('admin.networks.delete.confirmMessage' as TranslationKey, {
        name: network.name,
        count: memberCount,
        type: networkType,
      }),
      [
        {
          text: t('common.cancel' as TranslationKey),
          style: 'cancel',
        },
        {
          text: t('common.delete' as TranslationKey),
          style: 'destructive',
          onPress: async () => {
            try {
              void mediumHaptic();
              const result = await deleteNetworkFn(network.id, deleteReason.trim() || undefined);

              if (result.success) {
                Logger.logUserAction('admin_network_deleted', {
                  networkId: network.id,
                  networkName: result.networkName ?? network.name,
                  membersNotified: result.membersNotified ?? 0,
                });
                toast.success(
                  t('admin.networks.delete.success' as TranslationKey, {
                    name: result.networkName ?? network.name,
                    count: result.membersNotified ?? 0,
                  })
                );
                setDeleteReason('');
                // Navigate back to networks list
                navigation.goBack();
              } else {
                toast.error(result.error ?? t('common.error' as TranslationKey));
              }
            } catch (err) {
              console.error('Delete network error:', err);
              toast.error(t('common.error' as TranslationKey));
            }
          },
        },
      ]
    );
  }, [network, canDelete, deleteLoading, deleteReason, deleteNetworkFn, t, toast, navigation]);

  // Render member item
  const renderMemberItem = useCallback(
    (member: AdminNetworkMember) => (
      <TouchableOpacity
        key={member.id}
        style={[styles.memberItem, { borderBottomColor: colors.border }]}
        onPress={() => {
          lightHaptic();
          navigation.navigate('AdminUserDetail', { userId: member.player_id });
        }}
      >
        <Image
          source={{ uri: member.player_avatar || DEFAULT_AVATAR }}
          style={styles.memberAvatar}
        />
        <View style={styles.memberInfo}>
          <Text size="sm" weight="medium" color={colors.text} numberOfLines={1}>
            {member.player_name || t('admin.users.anonymous' as TranslationKey)}
          </Text>
          <View style={styles.memberMeta}>
            <View
              style={[
                styles.roleBadge,
                {
                  backgroundColor:
                    member.role === 'admin'
                      ? colors.accentLight
                      : member.role === 'moderator'
                        ? colors.warningBg
                        : colors.successBg,
                },
              ]}
            >
              <Text
                size="xs"
                color={
                  member.role === 'admin'
                    ? colors.accent
                    : member.role === 'moderator'
                      ? colors.warningText
                      : colors.successText
                }
              >
                {member.role}
              </Text>
            </View>
            <Text size="xs" color={colors.textMuted}>
              {formatDate(member.joined_at)}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.iconMuted} />
      </TouchableOpacity>
    ),
    [colors, t, navigation, formatDate]
  );

  // Render facility item
  const renderFacilityItem = useCallback(
    (facility: AdminNetworkFacility) => (
      <View key={facility.id} style={[styles.facilityItem, { borderBottomColor: colors.border }]}>
        <Ionicons name="location" size={20} color={colors.accent} />
        <View style={styles.facilityInfo}>
          <Text size="sm" weight="medium" color={colors.text} numberOfLines={1}>
            {facility.name}
          </Text>
          {facility.address && (
            <Text size="xs" color={colors.textMuted} numberOfLines={1}>
              {facility.address}
            </Text>
          )}
        </View>
      </View>
    ),
    [colors]
  );

  // Access denied view
  if (!hasAccess) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="lock-closed" size={64} color={colors.textMuted} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.centeredTitle}>
            {t('admin.accessDenied' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textSecondary} style={styles.centeredText}>
            {t('admin.networks.accessDeniedDescription' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Loading state
  if (loading && !network) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error && !network) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={64} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.centeredTitle}>
            {t('common.error' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textSecondary} style={styles.centeredText}>
            {error.message}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={refetch}
          >
            <Text size="sm" weight="medium" color={BASE_WHITE}>
              {t('common.retry' as TranslationKey)}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!network) return null;

  const isGroup = network.network_type === 'player_group';
  const members = network.members || [];
  const facilities = network.favorite_facilities || [];
  const displayedMembers = showMembersExpanded ? members : members.slice(0, 5);
  const displayedFacilities = showFacilitiesExpanded ? facilities : facilities.slice(0, 3);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.accent} />
        }
      >
        {/* Cover Image & Header */}
        <View style={styles.headerSection}>
          <Image
            source={{ uri: network.cover_image_url || DEFAULT_COVER }}
            style={styles.coverImage}
          />
          <View style={styles.coverOverlay} />

          {/* Type Badge */}
          <View
            style={[
              styles.typeBadge,
              {
                backgroundColor: isGroup ? colors.warningBg : colors.accentLight,
              },
            ]}
          >
            <Ionicons
              name={isGroup ? 'people' : 'globe'}
              size={14}
              color={isGroup ? colors.warningText : colors.accent}
            />
            <Text
              size="sm"
              weight="medium"
              color={isGroup ? colors.warningText : colors.accent}
              style={styles.typeBadgeText}
            >
              {isGroup
                ? t('admin.networks.types.group' as TranslationKey)
                : t('admin.networks.types.community' as TranslationKey)}
            </Text>
          </View>

          {/* Certification Badge (for communities) */}
          {isCommunity && network.is_certified && (
            <View style={[styles.certifiedHeaderBadge, { backgroundColor: colors.certifiedBg }]}>
              <MaterialCommunityIcons
                name="check-decagram"
                size={18}
                color={colors.certifiedText}
              />
              <Text
                size="sm"
                weight="medium"
                color={colors.certifiedText}
                style={{ marginLeft: 4 }}
              >
                {t('admin.networks.certified' as TranslationKey)}
              </Text>
            </View>
          )}
        </View>

        {/* Network Info Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <View style={styles.networkTitleRow}>
            <Text size="xl" weight="bold" color={colors.text} style={styles.networkName}>
              {network.name}
            </Text>
            {isCommunity && network.is_certified && (
              <MaterialCommunityIcons
                name="check-decagram"
                size={20}
                color={colors.certifiedText}
              />
            )}
          </View>

          {/* Stats Row */}
          <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
            <View style={styles.statItem}>
              <Ionicons name="people" size={18} color={colors.accent} />
              <Text size="sm" weight="medium" color={colors.text}>
                {network.member_count}
                {network.max_members ? `/${network.max_members}` : ''}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {t('admin.networks.members' as TranslationKey)}
              </Text>
            </View>

            {network.sport_name && (
              <View style={styles.statItem}>
                <Ionicons name="tennisball" size={18} color={colors.accent} />
                <Text size="sm" weight="medium" color={colors.text}>
                  {network.sport_name}
                </Text>
              </View>
            )}

            <View style={styles.statItem}>
              <Ionicons
                name={network.is_private ? 'lock-closed' : 'globe'}
                size={18}
                color={network.is_private ? colors.warningText : colors.successText}
              />
              <Text size="sm" weight="medium" color={colors.text}>
                {network.is_private
                  ? t('admin.networks.private' as TranslationKey)
                  : t('admin.networks.public' as TranslationKey)}
              </Text>
            </View>
          </View>
        </View>

        {/* About Section */}
        {network.description && (
          <View
            style={[
              styles.aboutCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <View style={styles.aboutHeader}>
              <Ionicons name="information-circle-outline" size={24} color={colors.accent} />
              <Text weight="semibold" size="base" style={{ color: colors.text, marginLeft: 8 }}>
                {t('admin.networks.about' as TranslationKey)}
              </Text>
            </View>
            <Text style={{ color: colors.textSecondary, lineHeight: 22, marginTop: 8 }}>
              {network.description}
            </Text>
          </View>
        )}

        {/* Certification Card (for communities only) */}
        {isCommunity && canCertify && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="shield-check" size={22} color={colors.accent} />
              <Text size="lg" weight="semibold" color={colors.text} style={styles.cardTitle}>
                {t('admin.networks.certification.title' as TranslationKey)}
              </Text>
            </View>

            {/* Current Status */}
            <View
              style={[
                styles.certificationStatus,
                {
                  backgroundColor: network.is_certified
                    ? colors.certifiedBg
                    : colors.inputBackground,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={network.is_certified ? 'check-decagram' : 'shield-off-outline'}
                size={24}
                color={network.is_certified ? colors.certifiedText : colors.textMuted}
              />
              <View style={styles.certificationStatusText}>
                <Text size="base" weight="medium" color={colors.text}>
                  {network.is_certified
                    ? t('admin.networks.certification.isCertified' as TranslationKey)
                    : t('admin.networks.certification.notCertified' as TranslationKey)}
                </Text>
                {network.is_certified && network.certified_at && (
                  <Text size="xs" color={colors.textMuted}>
                    {t('admin.networks.certification.certifiedAt' as TranslationKey)}{' '}
                    {formatDate(network.certified_at)}
                    {network.certified_by_name &&
                      ` ${t('common.by' as TranslationKey)} ${network.certified_by_name}`}
                  </Text>
                )}
              </View>
            </View>

            {/* Certification Notes */}
            {network.certification_notes && (
              <View style={[styles.notesContainer, { backgroundColor: colors.inputBackground }]}>
                <Text size="xs" weight="medium" color={colors.textMuted}>
                  {t('admin.networks.certification.notes' as TranslationKey)}
                </Text>
                <Text size="sm" color={colors.textSecondary}>
                  {network.certification_notes}
                </Text>
              </View>
            )}

            {/* Notes Input */}
            <View style={styles.notesInputContainer}>
              <Text size="sm" weight="medium" color={colors.text} style={styles.notesLabel}>
                {network.is_certified
                  ? t('admin.networks.certification.uncertifyNotes' as TranslationKey)
                  : t('admin.networks.certification.certifyNotes' as TranslationKey)}
              </Text>
              <TextInput
                style={[
                  styles.notesInput,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                placeholder={t('admin.networks.certification.notesPlaceholder' as TranslationKey)}
                placeholderTextColor={colors.textMuted}
                value={certificationNotes}
                onChangeText={setCertificationNotes}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Certification Button */}
            <TouchableOpacity
              style={[
                styles.certifyButton,
                {
                  backgroundColor: network.is_certified ? colors.warningBg : colors.certifiedBg,
                },
              ]}
              onPress={handleCertificationToggle}
              disabled={certifyLoading}
            >
              {certifyLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={network.is_certified ? 'shield-off' : 'check-decagram'}
                    size={20}
                    color={network.is_certified ? colors.warningText : colors.certifiedText}
                  />
                  <Text
                    size="base"
                    weight="semibold"
                    color={network.is_certified ? colors.warningText : colors.certifiedText}
                    style={styles.certifyButtonText}
                  >
                    {network.is_certified
                      ? t('admin.networks.certification.uncertify' as TranslationKey)
                      : t('admin.networks.certification.certify' as TranslationKey)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Details Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Ionicons name="information-circle" size={22} color={colors.accent} />
            <Text size="lg" weight="semibold" color={colors.text} style={styles.cardTitle}>
              {t('admin.networks.details' as TranslationKey)}
            </Text>
          </View>

          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Text size="xs" color={colors.textMuted}>
                {t('admin.networks.createdBy' as TranslationKey)}
              </Text>
              <Text size="sm" weight="medium" color={colors.text}>
                {network.creator_name || t('admin.networks.unknownCreator' as TranslationKey)}
              </Text>
            </View>

            <View style={styles.detailItem}>
              <Text size="xs" color={colors.textMuted}>
                {t('admin.networks.createdAt' as TranslationKey)}
              </Text>
              <Text size="sm" weight="medium" color={colors.text}>
                {formatDate(network.created_at)}
              </Text>
            </View>

            {network.invite_code && (
              <View style={styles.detailItem}>
                <Text size="xs" color={colors.textMuted}>
                  {t('admin.networks.inviteCode' as TranslationKey)}
                </Text>
                <Text size="sm" weight="medium" color={colors.accent}>
                  {network.invite_code}
                </Text>
              </View>
            )}

            {network.updated_at && (
              <View style={styles.detailItem}>
                <Text size="xs" color={colors.textMuted}>
                  {t('admin.networks.updatedAt' as TranslationKey)}
                </Text>
                <Text size="sm" weight="medium" color={colors.text}>
                  {formatDate(network.updated_at)}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Members Card */}
        {members.length > 0 && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <Ionicons name="people" size={22} color={colors.accent} />
              <Text size="lg" weight="semibold" color={colors.text} style={styles.cardTitle}>
                {t('admin.networks.membersList' as TranslationKey)} ({members.length})
              </Text>
            </View>

            {displayedMembers.map(renderMemberItem)}

            {members.length > 5 && (
              <TouchableOpacity
                style={[styles.expandButton, { borderTopColor: colors.border }]}
                onPress={() => {
                  lightHaptic();
                  setShowMembersExpanded(!showMembersExpanded);
                }}
              >
                <Text size="sm" weight="medium" color={colors.accent}>
                  {showMembersExpanded
                    ? t('common.showLess' as TranslationKey)
                    : t('common.showAll' as TranslationKey, { count: members.length })}
                </Text>
                <Ionicons
                  name={showMembersExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.accent}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Favorite Facilities Card */}
        {facilities.length > 0 && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <Ionicons name="location" size={22} color={colors.accent} />
              <Text size="lg" weight="semibold" color={colors.text} style={styles.cardTitle}>
                {t('admin.networks.favoriteFacilities' as TranslationKey)} ({facilities.length})
              </Text>
            </View>

            {displayedFacilities.map(renderFacilityItem)}

            {facilities.length > 3 && (
              <TouchableOpacity
                style={[styles.expandButton, { borderTopColor: colors.border }]}
                onPress={() => {
                  lightHaptic();
                  setShowFacilitiesExpanded(!showFacilitiesExpanded);
                }}
              >
                <Text size="sm" weight="medium" color={colors.accent}>
                  {showFacilitiesExpanded
                    ? t('common.showLess' as TranslationKey)
                    : t('common.showAll' as TranslationKey, { count: facilities.length })}
                </Text>
                <Ionicons
                  name={showFacilitiesExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.accent}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Danger Zone Card */}
        {canDelete && (
          <View
            style={[
              styles.dangerZoneCard,
              { backgroundColor: colors.errorBg, borderColor: colors.errorText },
            ]}
          >
            <View style={styles.cardHeader}>
              <Ionicons name="warning" size={22} color={colors.errorText} />
              <Text size="lg" weight="semibold" color={colors.errorText} style={styles.cardTitle}>
                {t('admin.networks.delete.dangerZone' as TranslationKey)}
              </Text>
            </View>

            <Text size="sm" color={colors.text} style={styles.dangerZoneDescription}>
              {t('admin.networks.delete.description' as TranslationKey)}
            </Text>

            {/* Delete Reason Input */}
            <View style={styles.deleteReasonContainer}>
              <Text size="sm" weight="medium" color={colors.text} style={styles.notesLabel}>
                {t('admin.networks.delete.reasonLabel' as TranslationKey)}
              </Text>
              <TextInput
                style={[
                  styles.notesInput,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                placeholder={t('admin.networks.delete.reasonPlaceholder' as TranslationKey)}
                placeholderTextColor={colors.textMuted}
                value={deleteReason}
                onChangeText={setDeleteReason}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* Delete Button */}
            <TouchableOpacity
              style={[
                styles.deleteButton,
                {
                  backgroundColor: colors.errorText,
                },
              ]}
              onPress={handleDeleteNetwork}
              disabled={deleteLoading}
            >
              {deleteLoading ? (
                <ActivityIndicator size="small" color={BASE_WHITE} />
              ) : (
                <>
                  <Ionicons name="trash" size={20} color={BASE_WHITE} />
                  <Text
                    size="base"
                    weight="semibold"
                    color={BASE_WHITE}
                    style={styles.deleteButtonText}
                  >
                    {network?.network_type === 'player_group'
                      ? t('admin.networks.delete.deleteGroup' as TranslationKey)
                      : t('admin.networks.delete.deleteCommunity' as TranslationKey)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Spacing */}
        <View style={styles.bottomSpacing} />
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
  },
  centeredTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  centeredText: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  headerSection: {
    height: 160,
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  typeBadge: {
    position: 'absolute',
    top: spacingPixels[3],
    left: spacingPixels[4],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.lg,
  },
  typeBadgeText: {
    marginLeft: spacingPixels[1],
  },
  certifiedHeaderBadge: {
    position: 'absolute',
    top: spacingPixels[3],
    right: spacingPixels[4],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.lg,
  },
  card: {
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[4],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  networkTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  networkName: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacingPixels[4],
    marginTop: spacingPixels[4],
    borderTopWidth: 1,
  },
  statItem: {
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  cardTitle: {
    marginLeft: spacingPixels[2],
  },
  certificationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
  },
  certificationStatusText: {
    marginLeft: spacingPixels[3],
    flex: 1,
  },
  notesContainer: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[3],
    gap: spacingPixels[1],
  },
  notesInputContainer: {
    marginBottom: spacingPixels[3],
  },
  notesLabel: {
    marginBottom: spacingPixels[2],
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    fontSize: fontSizePixels.sm,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  certifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  certifyButtonText: {
    marginLeft: spacingPixels[2],
  },
  inputBackground: {},
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[4],
  },
  detailItem: {
    minWidth: '45%',
    gap: spacingPixels[1],
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  memberInfo: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  memberMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[1],
  },
  roleBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5] || 2,
    borderRadius: radiusPixels.sm,
  },
  facilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  facilityInfo: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacingPixels[3],
    marginTop: spacingPixels[2],
    borderTopWidth: 1,
    gap: spacingPixels[1],
  },
  bottomSpacing: {
    height: spacingPixels[8],
  },
  aboutCard: {
    padding: 20,
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[4],
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneCard: {
    padding: spacingPixels[4],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[6],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  dangerZoneDescription: {
    marginBottom: spacingPixels[4],
    lineHeight: 20,
  },
  deleteReasonContainer: {
    marginBottom: spacingPixels[3],
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  deleteButtonText: {
    marginLeft: spacingPixels[2],
  },
});

export default AdminNetworkDetailScreen;
