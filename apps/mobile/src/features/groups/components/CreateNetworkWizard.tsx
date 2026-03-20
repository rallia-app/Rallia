/**
 * CreateNetworkWizard
 *
 * Wizard wrapper for creating a Group or Community from the ActionsBottomSheet.
 * Includes a segmented toggle to switch between Group and Community creation.
 * Slides in with a header (back arrow + close).
 */

import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';
import { useTranslation, type TranslationKey } from '../../../hooks/useTranslation';

import { CreateGroupForm } from './CreateGroupModal';
import { CreateCommunityForm } from '../../communities/components/CreateCommunityModal';

// ============================================================================
// TYPES
// ============================================================================

type NetworkType = 'group' | 'community';

interface CreateNetworkWizardProps {
  onClose: () => void;
  onBackToLanding: () => void;
  onSuccess: (type: NetworkType, id: string) => void;
}

// ============================================================================
// HEADER
// ============================================================================

interface HeaderProps {
  onBackToLanding: () => void;
  onClose: () => void;
  t: (key: TranslationKey) => string;
  colors: { text: string; buttonActive: string; textMuted: string; border: string };
}

const Header: React.FC<HeaderProps> = ({ onBackToLanding, onClose, t, colors }) => {
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.headerLeft}>
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            lightHaptic();
            onBackToLanding();
          }}
          style={styles.headerButton}
          accessibilityLabel="Back to actions"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back-outline" size={24} color={colors.buttonActive} />
        </TouchableOpacity>
      </View>

      <Text size="base" weight="semibold" color={colors.text}>
        {t('actions.createNetwork')}
      </Text>

      <View style={styles.headerRight}>
        <TouchableOpacity
          onPress={() => {
            Keyboard.dismiss();
            lightHaptic();
            onClose();
          }}
          style={styles.headerButton}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        >
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ============================================================================
// SEGMENTED CONTROL
// ============================================================================

interface SegmentedControlProps {
  selected: NetworkType;
  onSelect: (type: NetworkType) => void;
  t: (key: TranslationKey) => string;
  colors: {
    text: string;
    textMuted: string;
    buttonActive: string;
    segmentBackground: string;
    segmentActiveBackground: string;
  };
}

const SegmentedControl: React.FC<SegmentedControlProps> = ({ selected, onSelect, t, colors }) => {
  return (
    <View style={[styles.segmentedContainer, { backgroundColor: colors.segmentBackground }]}>
      <TouchableOpacity
        style={[
          styles.segment,
          selected === 'group' && [
            styles.segmentActive,
            { backgroundColor: colors.segmentActiveBackground },
          ],
        ]}
        onPress={() => {
          lightHaptic();
          onSelect('group');
        }}
        activeOpacity={0.7}
      >
        <Ionicons
          name="people-outline"
          size={18}
          color={selected === 'group' ? colors.buttonActive : colors.textMuted}
          style={{ marginRight: 6 }}
        />
        <Text
          size="sm"
          weight={selected === 'group' ? 'semibold' : 'medium'}
          color={selected === 'group' ? colors.buttonActive : colors.textMuted}
        >
          {t('actions.group')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.segment,
          selected === 'community' && [
            styles.segmentActive,
            { backgroundColor: colors.segmentActiveBackground },
          ],
        ]}
        onPress={() => {
          lightHaptic();
          onSelect('community');
        }}
        activeOpacity={0.7}
      >
        <Ionicons
          name="globe-outline"
          size={18}
          color={selected === 'community' ? colors.buttonActive : colors.textMuted}
          style={{ marginRight: 6 }}
        />
        <Text
          size="sm"
          weight={selected === 'community' ? 'semibold' : 'medium'}
          color={selected === 'community' ? colors.buttonActive : colors.textMuted}
        >
          {t('actions.community')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const CreateNetworkWizard: React.FC<CreateNetworkWizardProps> = ({
  onClose,
  onBackToLanding,
  onSuccess,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  const [selectedType, setSelectedType] = useState<NetworkType>('group');
  // Key to force remount of form when switching types (resets form state)
  const [formKey, setFormKey] = useState(0);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      segmentBackground: isDark ? '#1C1C1E' : '#F2F2F7',
      segmentActiveBackground: themeColors.card,
    }),
    [themeColors, isDark]
  );

  const handleTypeChange = useCallback((type: NetworkType) => {
    setSelectedType(type);
    setFormKey(prev => prev + 1);
  }, []);

  const handleGroupSuccess = useCallback(
    (groupId: string) => {
      onSuccess('group', groupId);
    },
    [onSuccess]
  );

  const handleCommunitySuccess = useCallback(
    (communityId: string) => {
      onSuccess('community', communityId);
    },
    [onSuccess]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <Header onBackToLanding={onBackToLanding} onClose={onClose} t={t} colors={colors} />

      <SegmentedControl selected={selectedType} onSelect={handleTypeChange} t={t} colors={colors} />

      {selectedType === 'group' ? (
        <CreateGroupForm
          key={`group-${formKey}`}
          onSuccess={handleGroupSuccess}
          onCancel={onBackToLanding}
        />
      ) : (
        <CreateCommunityForm
          key={`community-${formKey}`}
          onSuccess={handleCommunitySuccess}
          onCancel={onBackToLanding}
        />
      )}
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerButton: {
    padding: spacingPixels[1],
  },
  segmentedContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[1],
    borderRadius: 12,
    padding: 4,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  segmentActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
});
