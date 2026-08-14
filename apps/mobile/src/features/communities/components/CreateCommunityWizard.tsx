/**
 * CreateCommunityWizard
 *
 * Wizard wrapper for creating a Community from the ActionsBottomSheet.
 * Slides in with a header (back arrow + close).
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { lightTheme, darkTheme, spacingPixels, primary } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useTheme } from '@rallia/shared-hooks';

import { useTranslation, type TranslationKey } from '#/hooks/useTranslation';

import { CreateCommunityForm } from './CreateCommunityModal';

// ============================================================================
// TYPES
// ============================================================================

interface CreateCommunityWizardProps {
  onClose: () => void;
  onBackToLanding: () => void;
  onSuccess: (id: string) => void;
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
        {t('actions.createCommunity')}
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
// MAIN COMPONENT
// ============================================================================

export const CreateCommunityWizard: React.FC<CreateCommunityWizardProps> = ({
  onClose,
  onBackToLanding,
  onSuccess,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
    }),
    [themeColors, isDark]
  );

  const handleSuccess = useCallback(
    (communityId: string) => {
      onSuccess(communityId);
    },
    [onSuccess]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <Header onBackToLanding={onBackToLanding} onClose={onClose} t={t} colors={colors} />

      <CreateCommunityForm onSuccess={handleSuccess} onCancel={onBackToLanding} />
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
});
