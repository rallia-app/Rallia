/**
 * ChatAgreementModal Component
 * Shows chat community guidelines when user enters a conversation for the first time
 */

import { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';

export function ChatAgreementActionSheet({ payload }: SheetProps<'chat-agreement'>) {
  const onAgree = payload?.onAgree;
  const onDecline = payload?.onDecline;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const handleAgree = useCallback(() => {
    successHaptic();
    onAgree?.();
    SheetManager.hide('chat-agreement');
  }, [onAgree]);

  const handleDecline = useCallback(() => {
    lightHaptic();
    onDecline?.();
    SheetManager.hide('chat-agreement');
  }, [onDecline]);

  const rules = [
    t('chat.rules.noHarassment'),
    t('chat.rules.noAdvertising'),
    t('chat.rules.noDisrespect'),
  ];

  return (
    <ActionSheet
      gestureEnabled={false}
      containerStyle={[styles.sheetContainer, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
      closable={false}
      closeOnTouchBackdrop={false}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text size="lg" weight="semibold" color={colors.text}>
          {t('chat.agreement.welcome')}
        </Text>
      </View>

      {/* Content */}
      <View style={styles.rulesContent}>
        <Text size="sm" color={colors.textMuted} style={styles.descriptionText}>
          {t('chat.agreement.description')}
        </Text>

        <Text size="base" weight="semibold" color={colors.text} style={styles.rulesTitle}>
          {t('chat.agreement.chatRules')}
        </Text>

        {rules.map((rule, index) => (
          <View key={index} style={styles.ruleItem}>
            <Ionicons name="close-circle" size={20} color="#EF4444" />
            <Text size="sm" color={colors.text} style={styles.ruleText}>
              {rule}
            </Text>
          </View>
        ))}

        <Text size="xs" color={colors.textMuted} style={styles.warningText}>
          {t('chat.agreement.warning')}
        </Text>
      </View>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.agreeButton, { backgroundColor: colors.primary }]}
          onPress={handleAgree}
          activeOpacity={0.8}
        >
          <Text size="base" weight="medium" color="#FFFFFF">
            {t('chat.agreement.agree')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.declineButton, { backgroundColor: colors.buttonInactive }]}
          onPress={handleDecline}
          activeOpacity={0.8}
        >
          <Text size="base" weight="medium" color={colors.textSecondary}>
            {t('chat.agreement.decline')}
          </Text>
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetContainer: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  descriptionText: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
  },
  rulesContent: {
    padding: spacingPixels[4],
  },
  rulesTitle: {
    marginBottom: spacingPixels[3],
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[3],
    gap: spacingPixels[3],
  },
  ruleText: {
    flex: 1,
  },
  warningText: {
    marginTop: spacingPixels[2],
    lineHeight: 18,
    textAlign: 'center',
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
  },
  agreeButton: {
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[2],
  },
  declineButton: {
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ChatAgreementActionSheet;
