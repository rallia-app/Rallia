import React, { useState, useEffect, useRef } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text } from '@rallia/shared-components';
import { PreferencesInfo } from '@rallia/shared-types';
import { selectionHaptic, mediumHaptic } from '../../../utils/haptics';
import { useThemeStyles } from '../../../hooks';
import { useTranslation, type TranslationKey } from '../../../hooks';
import { FavoriteFacilitiesSelector } from './FavoriteFacilitiesSelector';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

/**
 * Dynamic play style option fetched from database
 */
export interface PlayStyleOption {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Dynamic play attribute option fetched from database
 */
export interface PlayAttributeOption {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}

export interface PlayAttributesByCategory {
  [category: string]: PlayAttributeOption[];
}

interface TennisPreferencesOverlayProps {
  visible: boolean;
  onClose: () => void;
  onSave: (preferences: PreferencesInfo) => void;
  initialPreferences?: PreferencesInfo;
  /** Dynamic play styles fetched from database */
  playStyleOptions?: PlayStyleOption[];
  /** Dynamic play attributes fetched from database, grouped by category */
  playAttributesByCategory?: PlayAttributesByCategory;
  /** Loading state for play options */
  loadingPlayOptions?: boolean;
  /** Player ID for favorite facilities */
  playerId?: string;
  /** Sport ID for filtering facilities */
  sportId?: string;
  /** User's latitude for distance calculation */
  latitude?: number | null;
  /** User's longitude for distance calculation */
  longitude?: number | null;
}

/**
 * Format a database name into a display label (fallback)
 * e.g., 'aggressive_baseliner' -> 'Aggressive Baseliner'
 */
const formatName = (name: string): string => {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Get translated play style name with fallback
 */
const getPlayStyleLabel = (name: string, t: (key: TranslationKey) => string): string => {
  const key = `profile.preferences.playStyles.${name}` as TranslationKey;
  const translated = t(key);
  // If translation returns the key itself, use formatName as fallback
  return translated === key ? formatName(name) : translated;
};

/**
 * Get translated play attribute name with fallback
 */
const getPlayAttributeLabel = (name: string, t: (key: TranslationKey) => string): string => {
  const key = `profile.preferences.playAttributes.${name}` as TranslationKey;
  const translated = t(key);
  return translated === key ? formatName(name) : translated;
};

/**
 * Get translated category name with fallback
 */
const getCategoryLabel = (category: string, t: (key: TranslationKey) => string): string => {
  const key = `profile.preferences.playAttributeCategories.${category}` as TranslationKey;
  const translated = t(key);
  return translated === key ? category : translated;
};

export function TennisPreferencesActionSheet({ payload }: SheetProps<'tennis-preferences'>) {
  const onSave = payload?.onSave;
  const onDismiss = payload?.onDismiss;
  const requireAllFields = payload?.requireAllFields || false;
  const initialPreferences = payload?.initialPreferences || {};
  const playStyleOptions = payload?.playStyleOptions || [];
  const playAttributesByCategory = payload?.playAttributesByCategory || {};
  const loadingPlayOptions = payload?.loadingPlayOptions || false;
  const playerId = payload?.playerId;
  const sportId = payload?.sportId;
  const latitude = payload?.latitude;
  const longitude = payload?.longitude;
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  // Track if save was called to distinguish between saved close and dismissed close
  const didSaveRef = useRef(false);

  const onClose = () => {
    // onBeforeClose will handle calling onDismiss if not saved
    SheetManager.hide('tennis-preferences');
  };

  const MATCH_DURATIONS: Array<{ value: '30' | '60' | '90' | '120'; label: string }> = [
    { value: '30', label: t('profile.preferences.durations.30') },
    { value: '60', label: t('profile.preferences.durations.60') },
    { value: '90', label: t('profile.preferences.durations.90') },
    { value: '120', label: t('profile.preferences.durations.120') },
  ];

  const MATCH_TYPES = [
    { value: 'casual', label: t('profile.preferences.matchTypes.casual') },
    { value: 'competitive', label: t('profile.preferences.matchTypes.competitive') },
    { value: 'both', label: t('profile.preferences.matchTypes.both') },
  ];

  // Build PLAY_STYLES from dynamic options with translations
  const PLAY_STYLES = playStyleOptions.map(style => ({
    value: style.name,
    label: getPlayStyleLabel(style.name, t),
    description: style.description,
  }));

  const [matchDuration, setMatchDuration] = useState<string | undefined>(
    initialPreferences.matchDuration
  );
  const [matchType, setMatchType] = useState<string | undefined>(initialPreferences.matchType);
  const [playStyle, setPlayStyle] = useState<string | undefined>(initialPreferences.playStyle);
  const [playAttributes, setPlayAttributes] = useState<string[]>(
    initialPreferences.playAttributes || []
  );
  const [showPlayStyleDropdown, setShowPlayStyleDropdown] = useState(false);

  const handleTogglePlayAttribute = (attributeName: string) => {
    selectionHaptic();
    setPlayAttributes(prev =>
      prev.includes(attributeName)
        ? prev.filter(a => a !== attributeName)
        : [...prev, attributeName]
    );
  };

  const handleSelectPlayStyle = (style: string) => {
    selectionHaptic();
    setPlayStyle(style);
    setShowPlayStyleDropdown(false);
  };

  const handleSave = () => {
    mediumHaptic();
    didSaveRef.current = true; // Mark as saved before closing
    onSave?.({
      matchDuration,
      matchType,
      playStyle,
      playAttributes,
    });
    SheetManager.hide('tennis-preferences');
  };

  // When requireAllFields is true, all fields are mandatory
  const canSave = requireAllFields
    ? matchDuration && matchType && playStyle && playAttributes.length > 0
    : matchDuration && matchType;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      onBeforeClose={() => {
        // Call onDismiss if sheet is closed without saving
        if (onDismiss && !didSaveRef.current) {
          onDismiss();
        }
      }}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text
              weight="semibold"
              size="lg"
              style={{ color: colors.text }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {t('profile.preferences.updateTennis')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Match Duration */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              {t('profile.preferences.matchDuration')}
            </Text>
            <View style={styles.chipsContainer}>
              {MATCH_DURATIONS.map(duration => (
                <TouchableOpacity
                  key={duration.value}
                  style={[
                    styles.chip,
                    { backgroundColor: colors.inputBackground },
                    matchDuration === duration.value && [
                      styles.chipSelected,
                      { backgroundColor: colors.primary },
                    ],
                  ]}
                  onPress={() => {
                    selectionHaptic();
                    setMatchDuration(duration.value);
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: colors.textMuted },
                      ...(matchDuration === duration.value
                        ? [styles.chipTextSelected, { color: colors.primaryForeground }]
                        : []),
                    ]}
                  >
                    {duration.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Match Type */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              {t('profile.preferences.matchType')}
            </Text>
            <View style={styles.chipsContainer}>
              {MATCH_TYPES.map(type => (
                <TouchableOpacity
                  key={type.value}
                  style={[
                    styles.chip,
                    { backgroundColor: colors.inputBackground },
                    matchType === type.value && [
                      styles.chipSelected,
                      { backgroundColor: colors.primary },
                    ],
                  ]}
                  onPress={() => {
                    selectionHaptic();
                    setMatchType(type.value);
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: colors.textMuted },
                      ...(matchType === type.value
                        ? [styles.chipTextSelected, { color: colors.primaryForeground }]
                        : []),
                    ]}
                  >
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Favorite Facilities */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              {t('profile.preferences.favoriteFacilities')}
            </Text>
            <Text style={[styles.sublabel, { color: colors.textMuted }]}>
              {t('profile.preferences.selectUpTo3')}
            </Text>
            {playerId && sportId ? (
              <FavoriteFacilitiesSelector
                playerId={playerId}
                sportId={sportId}
                latitude={latitude ?? null}
                longitude={longitude ?? null}
                colors={{
                  text: colors.text,
                  textMuted: colors.textMuted,
                  inputBackground: colors.inputBackground,
                  border: colors.border,
                  primary: colors.primary,
                  primaryForeground: colors.primaryForeground,
                  card: colors.card,
                }}
                t={(key: string) => t(key as Parameters<typeof t>[0])}
              />
            ) : (
              <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>Loading...</Text>
            )}
          </View>

          {/* Play Style */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              {t('profile.preferences.playStyle')}
            </Text>
            <TouchableOpacity
              style={[
                styles.inputContainer,
                { backgroundColor: colors.inputBackground, borderColor: colors.border },
              ]}
              onPress={() => {
                selectionHaptic();
                setShowPlayStyleDropdown(!showPlayStyleDropdown);
              }}
            >
              <Text
                style={[
                  styles.input,
                  styles.dropdownText,
                  { color: playStyle ? colors.text : colors.textMuted },
                ]}
              >
                {playStyle
                  ? PLAY_STYLES.find(s => s.value === playStyle)?.label
                  : t('profile.preferences.selectPlayStyle')}
              </Text>
              <Ionicons
                name={showPlayStyleDropdown ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textMuted}
                style={styles.inputIcon}
              />
            </TouchableOpacity>

            {showPlayStyleDropdown && (
              <View
                style={[
                  styles.dropdown,
                  { backgroundColor: colors.inputBackground, borderColor: colors.border },
                ]}
              >
                {PLAY_STYLES.map(style => (
                  <TouchableOpacity
                    key={style.value}
                    style={[
                      styles.dropdownItem,
                      { borderBottomColor: colors.border },
                      playStyle === style.value && [
                        styles.dropdownItemSelected,
                        { backgroundColor: colors.card },
                      ],
                    ]}
                    onPress={() => handleSelectPlayStyle(style.value)}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        { color: colors.text },
                        ...(playStyle === style.value
                          ? [
                              styles.dropdownItemTextSelected,
                              { color: colors.primary, fontWeight: '600' as const },
                            ]
                          : []),
                      ]}
                    >
                      {style.label}
                    </Text>
                    {playStyle === style.value && (
                      <Ionicons name="checkmark-outline" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Play Attributes - grouped by category */}
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>
              {t('profile.fields.playAttributes')}
            </Text>
            <Text style={[styles.sublabel, { color: colors.textMuted }]}>
              {t('profile.preferences.selectAllThatApply')}
            </Text>
            {loadingPlayOptions ? (
              <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
                {t('common.loading')}
              </Text>
            ) : Object.keys(playAttributesByCategory).length > 0 ? (
              Object.entries(playAttributesByCategory).map(([category, attributes]) => (
                <View key={category} style={styles.categorySection}>
                  <Text style={[styles.categoryLabel, { color: colors.textMuted }]}>
                    {getCategoryLabel(category, t)}
                  </Text>
                  <View style={styles.chipsContainer}>
                    {attributes.map(attribute => (
                      <TouchableOpacity
                        key={attribute.name}
                        style={[
                          styles.attributeChip,
                          { backgroundColor: colors.inputBackground },
                          playAttributes.includes(attribute.name) && [
                            styles.attributeChipSelected,
                            { backgroundColor: colors.primary },
                          ],
                        ]}
                        onPress={() => handleTogglePlayAttribute(attribute.name)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: colors.textMuted },
                            ...(playAttributes.includes(attribute.name)
                              ? [styles.chipTextSelected, { color: colors.primaryForeground }]
                              : []),
                          ]}
                        >
                          {getPlayAttributeLabel(attribute.name, t)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))
            ) : (
              <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>
                No attributes available
              </Text>
            )}
          </View>
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              !canSave && { opacity: 0.6 },
            ]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.8}
          >
            <Text weight="semibold" style={{ color: colors.primaryForeground }}>
              {t('common.save')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const TennisPreferencesOverlay: React.FC<TennisPreferencesOverlayProps> = ({
  visible,
  onClose,
  onSave,
  initialPreferences,
  playStyleOptions,
  playAttributesByCategory,
  loadingPlayOptions,
  playerId,
  sportId,
  latitude,
  longitude,
}) => {
  useEffect(() => {
    if (visible) {
      SheetManager.show('tennis-preferences', {
        payload: {
          onSave,
          initialPreferences,
          playStyleOptions,
          playAttributesByCategory,
          loadingPlayOptions,
          playerId,
          sportId,
          latitude,
          longitude,
        },
      });
    }
  }, [
    visible,
    onSave,
    initialPreferences,
    playStyleOptions,
    playAttributesByCategory,
    loadingPlayOptions,
    playerId,
    sportId,
    latitude,
    longitude,
  ]);

  useEffect(() => {
    if (!visible) {
      SheetManager.hide('tennis-preferences');
    }
  }, [visible]);

  return null;
};

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  modalContent: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
    position: 'relative',
    minHeight: 56,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[12],
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
    zIndex: 1,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  sublabel: {
    fontSize: 14,
    marginBottom: 12,
    marginTop: -8,
  },
  categorySection: {
    marginBottom: 16,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  chip: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  attributeChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 0,
    marginBottom: 8,
    marginRight: 8,
  },
  attributeChipSelected: {
    // backgroundColor applied inline
  },
  chipSelected: {
    // backgroundColor and borderColor applied inline
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextSelected: {
    // color applied inline
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  dropdownText: {
    paddingVertical: 14,
  },
  placeholder: {
    // color applied inline
  },
  inputIcon: {
    marginLeft: 8,
  },
  dropdown: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  dropdownItemSelected: {
    // backgroundColor applied inline
  },
  dropdownItemText: {
    fontSize: 16,
  },
  dropdownItemTextSelected: {
    // fontWeight and color applied inline
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: radiusPixels.lg,
  },
});
