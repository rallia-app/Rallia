/**
 * InvitePlayersWizard
 *
 * Single-screen invite players panel with three tabs:
 * - Code: referral code display
 * - QR Code: scannable QR code
 * - Contacts: device contacts picker with SMS compose
 *
 * Slides in from the ActionsBottomSheet.
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { lightTheme, darkTheme, spacingPixels, primary, neutral } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useTheme, useReferral } from '@rallia/shared-hooks';
import { useTranslation, type TranslationKey } from '../../../hooks/useTranslation';
import { useAuth } from '../../../hooks';

import { ShareLinkStep } from './steps/ShareLinkStep';

const BASE_WHITE = '#ffffff';

// ============================================================================
// TYPES
// ============================================================================

interface InvitePlayersWizardProps {
  onClose: () => void;
  onBackToLanding: () => void;
}

export interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  progressActive: string;
  progressInactive: string;
}

// ============================================================================
// HEADER
// ============================================================================

interface HeaderProps {
  onBackToLanding: () => void;
  onClose: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}

const Header: React.FC<HeaderProps> = ({ onBackToLanding, onClose, colors, t }) => {
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

      {/* Title */}
      <Text size="base" weight="semibold" color={colors.text}>
        {t('referral.wizardTitle')}
      </Text>

      {/* Close button */}
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

export const InvitePlayersWizard: React.FC<InvitePlayersWizardProps> = ({
  onClose,
  onBackToLanding,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const isDark = theme === 'dark';

  const playerId = session?.user?.id;
  const { code, codeLoading, referralLink, stats, statsLoading } = useReferral(playerId);

  const [activeTab, setActiveTab] = useState<'code' | 'qr' | 'contacts'>('code');

  // Theme colors
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors: ThemeColors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: BASE_WHITE,
      progressActive: isDark ? primary[500] : primary[600],
      progressInactive: themeColors.muted,
    }),
    [themeColors, isDark]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.cardBackground }]}>
      <Header onBackToLanding={onBackToLanding} onClose={onClose} colors={colors} t={t} />

      <ShareLinkStep
        code={code}
        codeLoading={codeLoading}
        referralLink={referralLink}
        stats={stats}
        statsLoading={statsLoading}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        colors={colors}
        isDark={isDark}
        t={t}
      />
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
