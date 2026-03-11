/**
 * AdminNetworksScreen
 *
 * Admin-level network management screen with search, filters, and pagination.
 * Displays networks (groups & communities) with key information and allows
 * navigation to detail view for certification.
 *
 * Access Requirements:
 * - User must have admin role with 'support' or higher level
 *
 * Features:
 * - Toggle between Groups and Communities
 * - Searchable network list
 * - Filter by certification status
 * - Pagination with load more
 * - Pull-to-refresh
 * - Navigate to network detail
 */

import React, { useState, useCallback, useMemo, memo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  ScrollView,
  Animated,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
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
import { Text } from '@rallia/shared-components';
import {
  useTheme,
  useAdminNetworks,
  useAdminStatus,
  hasMinimumRole,
  useSports,
  useNetworkLimits,
  type AdminNetworkInfo,
  type AdminNetworkType,
  type Sport,
} from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';
import type { TranslationKey } from '@rallia/shared-translations';
import { lightHaptic, selectionHaptic } from '@rallia/shared-utils';

import { useTranslation } from '../hooks';
import type { RootStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const BASE_WHITE = '#ffffff';
const DEFAULT_COVER =
  'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=400&h=200&fit=crop';

// =============================================================================
// TYPES
// =============================================================================

type NetworkTypeFilter = AdminNetworkType;
type CertificationFilter = 'all' | 'certified' | 'uncertified';
type PrivacyFilter = 'all' | 'public' | 'private';
type SportFilter = string; // 'all' or sport UUID

// =============================================================================
// FILTER CHIP COMPONENT
// =============================================================================

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  materialIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  showBothSportsIcon?: boolean;
}

const FilterChip = memo(function FilterChip({
  label,
  isActive,
  onPress,
  isDark,
  icon,
  materialIcon,
  showBothSportsIcon,
}: FilterChipProps) {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];

  const handlePress = () => {
    void lightHaptic();
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  const renderIcon = () => {
    if (showBothSportsIcon) {
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <MaterialCommunityIcons name="tennis" size={12} color={textColor} />
          <Text style={{ color: textColor, marginHorizontal: 1, fontSize: 8 }}>+</Text>
          <MaterialCommunityIcons name="badminton" size={12} color={textColor} />
        </View>
      );
    }
    if (materialIcon) {
      return (
        <MaterialCommunityIcons
          name={materialIcon}
          size={14}
          color={textColor}
          style={styles.filterChipIcon}
        />
      );
    }
    if (icon) {
      return <Ionicons name={icon} size={14} color={textColor} style={styles.filterChipIcon} />;
    }
    return null;
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.filterChip,
          {
            backgroundColor: bgColor,
            borderColor: borderColor,
          },
        ]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        {renderIcon()}
        <Text size="xs" weight={isActive ? 'semibold' : 'medium'} color={textColor}>
          {label}
        </Text>
        <Ionicons
          name="chevron-down-outline"
          size={12}
          color={textColor}
          style={styles.filterChipChevron}
        />
      </TouchableOpacity>
    </Animated.View>
  );
});

// =============================================================================
// FILTER DROPDOWN MODAL
// =============================================================================

interface FilterDropdownOption<T> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  materialIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
}

interface FilterDropdownProps<T extends string> {
  visible: boolean;
  title: string;
  options: FilterDropdownOption<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
  isDark: boolean;
}

function FilterDropdown<T extends string>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  isDark,
}: FilterDropdownProps<T>) {
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = {
    dropdownBg: themeColors.card,
    dropdownBorder: themeColors.border,
    itemText: themeColors.foreground,
    itemTextSelected: primary[500],
    itemBg: 'transparent',
    itemBgSelected: isDark ? `${primary[500]}20` : `${primary[500]}10`,
    itemBorder: themeColors.border,
    overlayBg: 'rgba(0, 0, 0, 0.5)',
    checkmark: primary[500],
  };

  const handleSelect = (value: T) => {
    void selectionHaptic();
    onSelect(value);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={onClose}>
        <View
          style={[
            styles.dropdownContainer,
            {
              backgroundColor: colors.dropdownBg,
              borderColor: colors.dropdownBorder,
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.dropdownHeader, { borderBottomColor: colors.itemBorder }]}>
            <Text size="base" weight="semibold" color={themeColors.foreground}>
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-outline" size={22} color={themeColors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Options list */}
          <ScrollView
            style={styles.dropdownScrollView}
            showsVerticalScrollIndicator={false}
            bounces={options.length > 6}
          >
            {options.map((option, index) => {
              const isSelected = selectedValue === option.value;
              const isLast = index === options.length - 1;

              return (
                <TouchableOpacity
                  key={String(option.value)}
                  style={[
                    styles.dropdownItem,
                    {
                      backgroundColor: isSelected ? colors.itemBgSelected : colors.itemBg,
                      borderBottomColor: isLast ? 'transparent' : colors.itemBorder,
                    },
                  ]}
                  onPress={() => handleSelect(option.value)}
                  activeOpacity={0.7}
                >
                  {option.materialIcon ? (
                    <MaterialCommunityIcons
                      name={option.materialIcon}
                      size={18}
                      color={isSelected ? colors.itemTextSelected : colors.itemText}
                      style={styles.dropdownItemIcon}
                    />
                  ) : option.icon ? (
                    <Ionicons
                      name={option.icon}
                      size={18}
                      color={isSelected ? colors.itemTextSelected : colors.itemText}
                      style={styles.dropdownItemIcon}
                    />
                  ) : null}
                  <Text
                    size="base"
                    weight={isSelected ? 'semibold' : 'regular'}
                    color={isSelected ? colors.itemTextSelected : colors.itemText}
                    style={styles.dropdownItemText}
                  >
                    {option.label}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle-outline" size={22} color={colors.checkmark} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

const AdminNetworksScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { isAdmin, role } = useAdminStatus();
  const { sports } = useSports();
  const { limits, loading: limitsLoading, updateLimits } = useNetworkLimits();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [networkType, setNetworkType] = useState<NetworkTypeFilter>('all');
  const [certificationFilter, setCertificationFilter] = useState<CertificationFilter>('all');
  const [sportFilter, setSportFilter] = useState<SportFilter>('all');
  const [privacyFilter, setPrivacyFilter] = useState<PrivacyFilter>('all');
  const [maxMembersInput, setMaxMembersInput] = useState<string>('');
  const [savingMaxMembers, setSavingMaxMembers] = useState(false);
  const [isEditingMaxMembers, setIsEditingMaxMembers] = useState(false);

  // Dropdown visibility states
  const [showCertificationDropdown, setShowCertificationDropdown] = useState(false);
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  const [showPrivacyDropdown, setShowPrivacyDropdown] = useState(false);

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
      inputBackground: isDark ? `${neutral[800]}` : `${neutral[100]}`,
      certifiedBg: isDark ? `${primary[500]}20` : `${primary[600]}10`,
      certifiedText: isDark ? primary[400] : primary[600],
    }),
    [themeColors, isDark]
  );

  // Filter options
  const certificationOptions: FilterDropdownOption<CertificationFilter>[] = useMemo(
    () => [
      {
        value: 'all',
        label: t('admin.networks.filters.all' as TranslationKey),
        icon: 'layers-outline',
      },
      {
        value: 'certified',
        label: t('admin.networks.filters.certified' as TranslationKey),
        icon: 'shield-checkmark-outline',
      },
      {
        value: 'uncertified',
        label: t('admin.networks.filters.uncertified' as TranslationKey),
        icon: 'shield-outline',
      },
    ],
    [t]
  );

  const privacyOptions: FilterDropdownOption<PrivacyFilter>[] = useMemo(
    () => [
      {
        value: 'all',
        label: t('admin.networks.filters.privacyAll' as TranslationKey),
        icon: 'earth-outline',
      },
      {
        value: 'public',
        label: t('admin.networks.filters.public' as TranslationKey),
        icon: 'globe-outline',
      },
      {
        value: 'private',
        label: t('admin.networks.filters.private' as TranslationKey),
        icon: 'lock-closed-outline',
      },
    ],
    [t]
  );

  const sportOptions: FilterDropdownOption<SportFilter>[] = useMemo(() => {
    const options: FilterDropdownOption<SportFilter>[] = [
      {
        value: 'all',
        label: t('admin.networks.filters.allSports' as TranslationKey),
        icon: 'apps-outline',
      },
    ];
    sports.forEach((sport: Sport) => {
      const isTennis = sport.name.toLowerCase().includes('tennis');
      options.push({
        value: sport.id,
        label: sport.display_name,
        materialIcon: isTennis ? 'tennis' : 'badminton',
      });
    });
    return options;
  }, [t, sports]);

  // Get current filter labels
  const getCertificationLabel = useCallback(() => {
    const option = certificationOptions.find(o => o.value === certificationFilter);
    return option?.label || t('admin.networks.filters.all' as TranslationKey);
  }, [certificationFilter, certificationOptions, t]);

  const getPrivacyLabel = useCallback(() => {
    const option = privacyOptions.find(o => o.value === privacyFilter);
    return option?.label || t('admin.networks.filters.privacyAll' as TranslationKey);
  }, [privacyFilter, privacyOptions, t]);

  const getSportLabel = useCallback(() => {
    if (sportFilter === 'all') {
      return t('admin.networks.filters.allSports' as TranslationKey);
    }
    const sport = sports.find((s: Sport) => s.id === sportFilter);
    return sport?.display_name || t('admin.networks.filters.allSports' as TranslationKey);
  }, [sportFilter, sports, t]);

  // Check if any filter is active (excluding default values)
  const hasActiveFilters = useMemo(() => {
    return certificationFilter !== 'all' || sportFilter !== 'all' || privacyFilter !== 'all';
  }, [certificationFilter, sportFilter, privacyFilter]);

  // Admin networks hook
  const { networks, totalCount, loading, error, hasMore, loadMore, refetch, setFilters } =
    useAdminNetworks({
      filters: {
        networkType: networkType,
        isCertified:
          certificationFilter === 'all' ? undefined : certificationFilter === 'certified',
        sportId: sportFilter === 'all' ? undefined : sportFilter,
        isPrivate: privacyFilter === 'all' ? undefined : privacyFilter === 'private',
        searchQuery: searchQuery.trim() || undefined,
      },
      pageSize: 20,
    });

  // Reset all filters
  const resetFilters = useCallback(() => {
    void lightHaptic();
    setCertificationFilter('all');
    setSportFilter('all');
    setPrivacyFilter('all');
    setFilters({
      networkType: networkType,
      isCertified: undefined,
      sportId: undefined,
      isPrivate: undefined,
      searchQuery: searchQuery.trim() || undefined,
    });
  }, [networkType, searchQuery, setFilters]);

  // Access check
  const hasAccess = isAdmin && hasMinimumRole(role, 'support');
  const canEditLimits = isAdmin && hasMinimumRole(role, 'super_admin');

  // Sync max members input when limits load
  useEffect(() => {
    if (limits?.max_group_members) {
      setMaxMembersInput(String(limits.max_group_members));
    }
  }, [limits?.max_group_members]);

  // Handle save max members
  const handleSaveMaxMembers = useCallback(async () => {
    const newValue = parseInt(maxMembersInput, 10);
    if (isNaN(newValue) || newValue < 2 || newValue > 100) {
      Alert.alert(
        t('common.error' as TranslationKey),
        t('admin.networks.maxMembers.invalidValue' as TranslationKey)
      );
      return;
    }

    setSavingMaxMembers(true);
    try {
      const result = await updateLimits({
        max_group_members: newValue,
        max_community_members: limits?.max_community_members ?? null,
      });

      if (result.success) {
        setIsEditingMaxMembers(false);
        Alert.alert(
          t('common.success' as TranslationKey),
          t('admin.networks.maxMembers.saveSuccess' as TranslationKey)
        );
        Logger.logUserAction('admin_max_members_updated', { newValue });
      } else {
        throw new Error(result.error);
      }
    } catch (err) {
      console.error('Error saving max members:', err);
      Alert.alert(
        t('common.error' as TranslationKey),
        t('admin.networks.maxMembers.saveError' as TranslationKey)
      );
    } finally {
      setSavingMaxMembers(false);
    }
  }, [maxMembersInput, limits, updateLimits, t]);

  // Handle search
  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      // Debounced search handled by setting filters
      const timer = setTimeout(() => {
        setFilters({
          networkType: networkType,
          isCertified:
            certificationFilter === 'all' ? undefined : certificationFilter === 'certified',
          sportId: sportFilter === 'all' ? undefined : sportFilter,
          isPrivate: privacyFilter === 'all' ? undefined : privacyFilter === 'private',
          searchQuery: text.trim() || undefined,
        });
      }, 300);
      return () => clearTimeout(timer);
    },
    [networkType, certificationFilter, sportFilter, privacyFilter, setFilters]
  );

  // Handle network type toggle
  const handleNetworkTypeChange = useCallback(
    (type: NetworkTypeFilter) => {
      void lightHaptic();
      setNetworkType(type);
      setFilters({
        networkType: type,
        isCertified:
          certificationFilter === 'all' ? undefined : certificationFilter === 'certified',
        sportId: sportFilter === 'all' ? undefined : sportFilter,
        isPrivate: privacyFilter === 'all' ? undefined : privacyFilter === 'private',
        searchQuery: searchQuery.trim() || undefined,
      });
      Logger.logUserAction('admin_networks_type_changed', { type });
    },
    [certificationFilter, sportFilter, privacyFilter, searchQuery, setFilters]
  );

  // Handle certification filter change
  const handleCertificationChange = useCallback(
    (filter: CertificationFilter) => {
      setCertificationFilter(filter);
      setFilters({
        networkType: networkType,
        isCertified: filter === 'all' ? undefined : filter === 'certified',
        sportId: sportFilter === 'all' ? undefined : sportFilter,
        isPrivate: privacyFilter === 'all' ? undefined : privacyFilter === 'private',
        searchQuery: searchQuery.trim() || undefined,
      });
      Logger.logUserAction('admin_networks_certification_filter_changed', { filter });
    },
    [networkType, sportFilter, privacyFilter, searchQuery, setFilters]
  );

  // Handle sport filter change
  const handleSportChange = useCallback(
    (sportId: SportFilter) => {
      setSportFilter(sportId);
      setFilters({
        networkType: networkType,
        isCertified:
          certificationFilter === 'all' ? undefined : certificationFilter === 'certified',
        sportId: sportId === 'all' ? undefined : sportId,
        isPrivate: privacyFilter === 'all' ? undefined : privacyFilter === 'private',
        searchQuery: searchQuery.trim() || undefined,
      });
      Logger.logUserAction('admin_networks_sport_filter_changed', { sportId });
    },
    [networkType, certificationFilter, privacyFilter, searchQuery, setFilters]
  );

  // Handle privacy filter change
  const handlePrivacyChange = useCallback(
    (filter: PrivacyFilter) => {
      setPrivacyFilter(filter);
      setFilters({
        networkType: networkType,
        isCertified:
          certificationFilter === 'all' ? undefined : certificationFilter === 'certified',
        sportId: sportFilter === 'all' ? undefined : sportFilter,
        isPrivate: filter === 'all' ? undefined : filter === 'private',
        searchQuery: searchQuery.trim() || undefined,
      });
      Logger.logUserAction('admin_networks_privacy_filter_changed', { filter });
    },
    [networkType, certificationFilter, sportFilter, searchQuery, setFilters]
  );

  // Handle network press
  const handleNetworkPress = useCallback(
    (network: AdminNetworkInfo) => {
      void lightHaptic();
      Logger.logUserAction('admin_network_detail_pressed', { networkId: network.id });
      navigation.navigate('AdminNetworkDetail', { networkId: network.id });
    },
    [navigation]
  );

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (hasMore && !loading) {
      void loadMore();
    }
  }, [hasMore, loading, loadMore]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Format date
  const formatDate = useCallback(
    (dateString: string | null): string => {
      if (!dateString) return t('common.never' as TranslationKey);
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
    [t]
  );

  // Get network type label
  const getNetworkTypeLabel = useCallback(
    (network: AdminNetworkInfo): string => {
      if (network.network_type === 'player_group') {
        return t('admin.networks.types.group' as TranslationKey);
      }
      return t('admin.networks.types.community' as TranslationKey);
    },
    [t]
  );

  // Render network card
  const renderNetworkCard = useCallback(
    ({ item }: { item: AdminNetworkInfo }) => {
      const isGroup = item.network_type === 'player_group';
      const isCommunity = item.network_type === 'community';

      return (
        <TouchableOpacity
          style={[
            styles.networkCard,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
          onPress={() => handleNetworkPress(item)}
          activeOpacity={0.7}
        >
          {/* Cover Image */}
          <View style={styles.coverContainer}>
            <Image
              source={{ uri: item.cover_image_url || DEFAULT_COVER }}
              style={styles.coverImage}
            />
            <View style={styles.coverOverlay} />
          </View>

          {/* Content */}
          <View style={styles.networkContent}>
            <View style={styles.networkHeader}>
              <View style={styles.networkTitleRow}>
                <Text
                  size="base"
                  weight="semibold"
                  color={colors.text}
                  numberOfLines={1}
                  style={styles.networkName}
                >
                  {item.name}
                </Text>
                {/* Type Badge next to name */}
                <View
                  style={[
                    styles.typeBadgeInline,
                    {
                      backgroundColor: isGroup ? colors.warningBg : colors.accentLight,
                      borderColor: isGroup ? colors.warningText : colors.accent,
                    },
                  ]}
                >
                  <Ionicons
                    name={isGroup ? 'people' : 'globe'}
                    size={10}
                    color={isGroup ? colors.warningText : colors.accent}
                  />
                  <Text
                    size="xs"
                    weight="medium"
                    color={isGroup ? colors.warningText : colors.accent}
                  >
                    {getNetworkTypeLabel(item)}
                  </Text>
                </View>
                {/* Certified Badge next to name */}
                {isCommunity && item.is_certified && (
                  <View
                    style={[
                      styles.certifiedBadgeInline,
                      { backgroundColor: colors.certifiedBg, borderColor: colors.certifiedText },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="check-decagram"
                      size={12}
                      color={colors.certifiedText}
                    />
                    <Text size="xs" weight="medium" color={colors.certifiedText}>
                      {t('admin.networks.certified' as TranslationKey)}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Stats Row */}
            <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
              <View style={styles.statItem}>
                <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  {item.member_count}
                  {item.max_members ? `/${item.max_members}` : ''}{' '}
                  {t('admin.networks.members' as TranslationKey)}
                </Text>
              </View>
              {/* Sport icon(s) - show both when null, single when specific */}
              {(() => {
                // null = both sports
                if (!item.sport_id) {
                  return (
                    <View style={styles.statItem}>
                      <View style={styles.sportIconContainer}>
                        <MaterialCommunityIcons name="tennis" size={14} color={colors.textMuted} />
                        <Text style={[styles.sportIconPlus, { color: colors.textMuted }]}>+</Text>
                        <MaterialCommunityIcons
                          name="badminton"
                          size={14}
                          color={colors.textMuted}
                        />
                      </View>
                    </View>
                  );
                }
                // Tennis
                if (item.sport_name?.toLowerCase() === 'tennis') {
                  return (
                    <View style={styles.statItem}>
                      <MaterialCommunityIcons name="tennis" size={14} color={colors.textMuted} />
                      <Text size="xs" color={colors.textMuted}>
                        {item.sport_name}
                      </Text>
                    </View>
                  );
                }
                // Pickleball
                if (item.sport_name?.toLowerCase() === 'pickleball') {
                  return (
                    <View style={styles.statItem}>
                      <MaterialCommunityIcons name="badminton" size={14} color={colors.textMuted} />
                      <Text size="xs" color={colors.textMuted}>
                        {item.sport_name}
                      </Text>
                    </View>
                  );
                }
                return null;
              })()}
              <View style={styles.statItem}>
                <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted}>
                  {formatDate(item.created_at)}
                </Text>
              </View>
            </View>

            {/* Creator & Privacy */}
            <View style={styles.footerRow}>
              <View style={styles.creatorInfo}>
                <Ionicons name="person-outline" size={12} color={colors.textMuted} />
                <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                  {item.creator_name || t('admin.networks.unknownCreator' as TranslationKey)}
                </Text>
              </View>
              <View style={styles.rightActions}>
                {item.is_private && (
                  <View style={[styles.privateBadge, { backgroundColor: colors.warningBg }]}>
                    <Ionicons name="lock-closed" size={10} color={colors.warningText} />
                    <Text size="xs" color={colors.warningText}>
                      {t('admin.networks.private' as TranslationKey)}
                    </Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={colors.iconMuted} />
              </View>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [colors, t, handleNetworkPress, formatDate, getNetworkTypeLabel]
  );

  // Render empty state
  const renderEmptyState = () => {
    if (loading) return null;

    return (
      <View style={styles.emptyState}>
        <Ionicons
          name={networkType === 'player_group' ? 'people-outline' : 'globe-outline'}
          size={64}
          color={colors.textMuted}
        />
        <Text size="lg" weight="medium" color={colors.text} style={styles.emptyTitle}>
          {searchQuery
            ? t('admin.networks.noResults' as TranslationKey)
            : t('admin.networks.empty' as TranslationKey)}
        </Text>
        <Text size="sm" color={colors.textSecondary} style={styles.emptyDescription}>
          {searchQuery
            ? t('admin.networks.tryDifferentSearch' as TranslationKey)
            : t('admin.networks.emptyDescription' as TranslationKey)}
        </Text>
      </View>
    );
  };

  // Render header
  const renderHeader = () => (
    <View style={styles.headerContainer}>
      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.inputBackground }]}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={t('admin.networks.searchPlaceholder' as TranslationKey)}
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Network Type Toggle */}
      <View style={[styles.toggleContainer, { backgroundColor: colors.inputBackground }]}>
        <TouchableOpacity
          style={[styles.toggleButton, networkType === 'all' && { backgroundColor: colors.accent }]}
          onPress={() => handleNetworkTypeChange('all')}
        >
          <Text
            size="sm"
            weight="medium"
            color={networkType === 'all' ? BASE_WHITE : colors.textSecondary}
          >
            {t('admin.networks.types.all' as TranslationKey)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            networkType === 'player_group' && { backgroundColor: colors.accent },
          ]}
          onPress={() => handleNetworkTypeChange('player_group')}
        >
          <Ionicons
            name="people"
            size={14}
            color={networkType === 'player_group' ? BASE_WHITE : colors.textSecondary}
          />
          <Text
            size="sm"
            weight="medium"
            color={networkType === 'player_group' ? BASE_WHITE : colors.textSecondary}
            style={styles.toggleText}
          >
            {t('admin.networks.types.groups' as TranslationKey)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            networkType === 'community' && { backgroundColor: colors.accent },
          ]}
          onPress={() => handleNetworkTypeChange('community')}
        >
          <Ionicons
            name="globe"
            size={14}
            color={networkType === 'community' ? BASE_WHITE : colors.textSecondary}
          />
          <Text
            size="sm"
            weight="medium"
            color={networkType === 'community' ? BASE_WHITE : colors.textSecondary}
            style={styles.toggleText}
          >
            {t('admin.networks.types.communities' as TranslationKey)}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Max Members Setting - Only shown for Groups toggle and super_admin */}
      {networkType === 'player_group' && canEditLimits && (
        <View
          style={[
            styles.maxMembersCard,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <View style={styles.maxMembersHeader}>
            <View style={styles.maxMembersIconContainer}>
              <Ionicons name="people" size={20} color={colors.accent} />
            </View>
            <View style={styles.maxMembersTextContainer}>
              <Text size="sm" weight="semibold" color={colors.text}>
                {t('admin.networks.maxMembers.title' as TranslationKey)}
              </Text>
              <Text size="xs" color={colors.textMuted}>
                {t('admin.networks.maxMembers.description' as TranslationKey)}
              </Text>
            </View>
          </View>
          <View style={styles.maxMembersInputRow}>
            <TextInput
              style={[
                styles.maxMembersInput,
                {
                  backgroundColor: isEditingMaxMembers
                    ? colors.inputBackground
                    : colors.cardBackground,
                  color: colors.text,
                  borderColor: isEditingMaxMembers ? colors.accent : colors.border,
                },
              ]}
              value={maxMembersInput}
              onChangeText={setMaxMembersInput}
              keyboardType="number-pad"
              placeholder="20"
              placeholderTextColor={colors.textMuted}
              editable={isEditingMaxMembers && !limitsLoading && !savingMaxMembers}
            />
            <TouchableOpacity
              style={[
                styles.maxMembersSaveButton,
                {
                  backgroundColor: isEditingMaxMembers ? colors.accent : colors.accentLight,
                  opacity: limitsLoading || savingMaxMembers ? 0.5 : 1,
                },
              ]}
              onPress={() => {
                if (isEditingMaxMembers) {
                  void handleSaveMaxMembers();
                } else {
                  void lightHaptic();
                  setIsEditingMaxMembers(true);
                }
              }}
              disabled={limitsLoading || savingMaxMembers}
            >
              {savingMaxMembers ? (
                <ActivityIndicator size="small" color={BASE_WHITE} />
              ) : isEditingMaxMembers ? (
                <>
                  <Ionicons name="checkmark" size={16} color={BASE_WHITE} />
                  <Text size="sm" weight="medium" color={BASE_WHITE} style={{ marginLeft: 4 }}>
                    {t('common.save' as TranslationKey)}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="create-outline" size={16} color={colors.accent} />
                  <Text size="sm" weight="medium" color={colors.accent} style={{ marginLeft: 4 }}>
                    {t('common.update' as TranslationKey)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Filter Bar - Horizontal Scrollable Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBarContent}
        style={styles.filterBar}
      >
        {/* Sport Filter Chip */}
        <FilterChip
          label={getSportLabel()}
          showBothSportsIcon={sportFilter === 'all'}
          materialIcon={
            sportFilter !== 'all'
              ? sports
                  .find((s: Sport) => s.id === sportFilter)
                  ?.name.toLowerCase()
                  .includes('tennis')
                ? 'tennis'
                : 'badminton'
              : undefined
          }
          isActive={sportFilter !== 'all'}
          onPress={() => {
            void selectionHaptic();
            setShowSportDropdown(true);
          }}
          isDark={isDark}
        />

        {/* Certification Filter Chip */}
        <FilterChip
          label={getCertificationLabel()}
          icon="shield-checkmark-outline"
          isActive={certificationFilter !== 'all'}
          onPress={() => {
            void selectionHaptic();
            setShowCertificationDropdown(true);
          }}
          isDark={isDark}
        />

        {/* Privacy Filter Chip */}
        <FilterChip
          label={getPrivacyLabel()}
          icon="lock-closed-outline"
          isActive={privacyFilter !== 'all'}
          onPress={() => {
            void selectionHaptic();
            setShowPrivacyDropdown(true);
          }}
          isDark={isDark}
        />

        {/* Reset Button (only show when filters active) */}
        {hasActiveFilters && (
          <TouchableOpacity
            style={[styles.resetButton, { borderColor: colors.border }]}
            onPress={resetFilters}
          >
            <Ionicons name="close-circle" size={16} color={colors.errorText} />
            <Text size="sm" color={colors.errorText} style={styles.resetButtonText}>
              {t('common.reset' as TranslationKey)}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Stats Row */}
      <View style={styles.statsRowHeader}>
        <Text size="sm" color={colors.textSecondary}>
          {totalCount} {t('admin.networks.networksFound' as TranslationKey)}
        </Text>
      </View>
    </View>
  );

  // Render footer (loading indicator)
  const renderFooter = () => {
    if (!loading || networks.length === 0) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  };

  // Access denied view
  if (!hasAccess) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.accessDenied}>
          <Ionicons name="lock-closed" size={64} color={colors.textMuted} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.accessDeniedTitle}>
            {t('admin.accessDenied' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textSecondary} style={styles.accessDeniedText}>
            {t('admin.networks.accessDeniedDescription' as TranslationKey)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error && networks.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle" size={64} color={colors.errorText} />
          <Text size="lg" weight="semibold" color={colors.text} style={styles.errorTitle}>
            {t('common.error' as TranslationKey)}
          </Text>
          <Text size="sm" color={colors.textSecondary} style={styles.errorText}>
            {error.message}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={handleRefresh}
          >
            <Text size="sm" weight="medium" color={BASE_WHITE}>
              {t('common.retry' as TranslationKey)}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <FlatList
        data={networks}
        keyExtractor={item => item.id}
        renderItem={renderNetworkCard}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.listContent}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={loading && networks.length === 0}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Sport Filter Dropdown */}
      <FilterDropdown<SportFilter>
        visible={showSportDropdown}
        onClose={() => setShowSportDropdown(false)}
        title={t('admin.networks.filters.sportTitle' as TranslationKey)}
        options={sportOptions}
        selectedValue={sportFilter}
        onSelect={value => {
          handleSportChange(value);
          setShowSportDropdown(false);
        }}
        isDark={isDark}
      />

      {/* Certification Filter Dropdown */}
      <FilterDropdown<CertificationFilter>
        visible={showCertificationDropdown}
        onClose={() => setShowCertificationDropdown(false)}
        title={t('admin.networks.filters.certificationTitle' as TranslationKey)}
        options={certificationOptions}
        selectedValue={certificationFilter}
        onSelect={value => {
          handleCertificationChange(value);
          setShowCertificationDropdown(false);
        }}
        isDark={isDark}
      />

      {/* Privacy Filter Dropdown */}
      <FilterDropdown<PrivacyFilter>
        visible={showPrivacyDropdown}
        onClose={() => setShowPrivacyDropdown(false)}
        title={t('admin.networks.filters.privacyTitle' as TranslationKey)}
        options={privacyOptions}
        selectedValue={privacyFilter}
        onSelect={value => {
          handlePrivacyChange(value);
          setShowPrivacyDropdown(false);
        }}
        isDark={isDark}
      />
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
  listContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  headerContainer: {
    marginBottom: spacingPixels[4],
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[3],
  },
  searchInput: {
    flex: 1,
    marginLeft: spacingPixels[2],
    fontSize: fontSizePixels.base,
    paddingVertical: spacingPixels[1],
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[1],
    marginBottom: spacingPixels[3],
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.md,
  },
  toggleText: {
    marginLeft: spacingPixels[1],
  },
  // Max Members Card Styles
  maxMembersCard: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    padding: spacingPixels[3],
    marginBottom: spacingPixels[3],
  },
  maxMembersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
  },
  maxMembersIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.md,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  maxMembersTextContainer: {
    flex: 1,
  },
  maxMembersInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  maxMembersInput: {
    flex: 1,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
    fontSize: fontSizePixels.base,
    textAlign: 'center',
  },
  maxMembersSaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.md,
    minWidth: 80,
  },
  // Filter Bar Styles
  filterBar: {
    marginBottom: spacingPixels[3],
  },
  filterBarContent: {
    paddingHorizontal: spacingPixels[1],
    gap: spacingPixels[2],
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[2],
  },
  filterChipIcon: {
    marginRight: spacingPixels[1],
  },
  filterChipChevron: {
    marginLeft: spacingPixels[1],
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  resetButtonText: {
    marginLeft: spacingPixels[1],
  },
  statsRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: spacingPixels[1],
  },
  // Filter Dropdown Styles
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dropdownContainer: {
    borderTopLeftRadius: radiusPixels.xl,
    borderTopRightRadius: radiusPixels.xl,
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[8],
    maxHeight: '70%',
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
    borderBottomWidth: 1,
  },
  dropdownScrollView: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginBottom: spacingPixels[1],
  },
  dropdownItemIcon: {
    marginRight: spacingPixels[3],
  },
  dropdownItemText: {
    flex: 1,
  },
  networkCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    marginBottom: spacingPixels[3],
    overflow: 'hidden',
  },
  coverContainer: {
    height: 80,
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  typeBadgeInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.sm,
    borderWidth: 1,
    marginLeft: spacingPixels[2],
    gap: spacingPixels[1],
  },
  certifiedBadgeInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[1.5],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.sm,
    borderWidth: 1,
    marginLeft: spacingPixels[1.5],
    gap: spacingPixels[1],
  },
  networkContent: {
    padding: spacingPixels[3],
  },
  networkHeader: {
    marginBottom: spacingPixels[2],
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
    flexWrap: 'wrap',
    paddingTop: spacingPixels[2],
    marginTop: spacingPixels[2],
    borderTopWidth: 1,
    gap: spacingPixels[3],
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  sportIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sportIconPlus: {
    marginHorizontal: 2,
    fontSize: 10,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacingPixels[2],
  },
  creatorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    flex: 1,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  privateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.sm,
    gap: spacingPixels[1],
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[16],
    paddingHorizontal: spacingPixels[4],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  accessDenied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
  },
  accessDeniedTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  accessDeniedText: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
  },
  errorTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  errorText: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[6],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
});

export default AdminNetworksScreen;
