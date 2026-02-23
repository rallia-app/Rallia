/**
 * ChatAgreementModal Component
 * Shows chat community guidelines when user enters a conversation for the first time
 * Adapts content based on chat type (direct vs group)
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text, Button } from '@rallia/shared-components';
import { useThemeStyles } from '../../../hooks';
import { spacingPixels, fontSizePixels, radiusPixels, primary } from '@rallia/design-system';
import { useTranslation } from '../../../hooks';

export function ChatAgreementActionSheet({ payload }: SheetProps<'chat-agreement'>) {
  const chatName = payload?.chatName ?? 'this chat';
  const chatImageUrl = payload?.chatImageUrl;
  const isDirectChat = payload?.isDirectChat ?? false;
  const onAgree = payload?.onAgree;

  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const handleAgree = useCallback(() => {
    onAgree?.();
    SheetManager.hide('chat-agreement');
  }, [onAgree]);

  const rules = [
    t('chat.rules.noHarassment'),
    t('chat.rules.noAdvertising'),
    t('chat.rules.noDisrespect'),
  ];

  // Different description based on chat type
  const description = isDirectChat
    ? t('chat.agreement.descriptionDirect')
    : t('chat.agreement.description');

  // Different icon based on chat type
  const iconName = isDirectChat ? 'chatbubble' : 'people';

  return (
    <ActionSheet
      gestureEnabled={false}
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={{ display: 'none' }}
      closable={false}
      closeOnTouchBackdrop={false}
    >
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Chat Image */}
          <View style={styles.imageContainer}>
            {chatImageUrl ? (
              <Image source={{ uri: chatImageUrl }} style={styles.chatImage} />
            ) : (
              <View style={[styles.placeholderImage, { backgroundColor: primary[100] }]}>
                <Ionicons name={iconName} size={40} color={primary[500]} />
              </View>
            )}
          </View>

          {/* Welcome Text */}
          <Text style={[styles.welcomeText, { color: colors.textMuted }]}>
            {isDirectChat ? t('chat.agreement.welcomeDirect') : t('chat.agreement.welcome')}
          </Text>
          <Text style={[styles.chatName, { color: colors.text }]}>{chatName}</Text>

          {/* Description */}
          <Text style={[styles.description, { color: colors.textMuted }]}>{description}</Text>

          {/* Rules Section */}
          <View style={styles.rulesSection}>
            <Text style={[styles.rulesTitle, { color: colors.text }]}>
              {t('chat.agreement.chatRules')}
            </Text>

            {rules.map((rule, index) => (
              <View key={index} style={styles.ruleRow}>
                <Ionicons name="close-outline" size={18} color="#EF4444" style={styles.ruleIcon} />
                <Text style={[styles.ruleText, { color: colors.text }]}>{rule}</Text>
              </View>
            ))}

            {/* Warning Text */}
            <Text style={[styles.warningText, { color: colors.textMuted }]}>
              {t('chat.agreement.warning')}
            </Text>
          </View>

          {/* Agree Button */}
          <Button onPress={handleAgree} variant="primary" fullWidth>
            {t('chat.agreement.agree')}
          </Button>
        </ScrollView>
      </View>
    </ActionSheet>
  );
}

// Keep old export for backwards compatibility during migration
export const ChatAgreementModal = ChatAgreementActionSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  content: {
    padding: spacingPixels[6],
    alignItems: 'center',
  },
  imageContainer: {
    marginBottom: spacingPixels[4],
  },
  chatImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  placeholderImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeText: {
    fontSize: fontSizePixels.base,
    marginBottom: spacingPixels[1],
  },
  chatName: {
    fontSize: fontSizePixels.lg,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacingPixels[3],
  },
  description: {
    fontSize: fontSizePixels.sm,
    textAlign: 'center',
    marginBottom: spacingPixels[5],
    lineHeight: 20,
  },
  rulesSection: {
    width: '100%',
    marginBottom: spacingPixels[5],
  },
  rulesTitle: {
    fontSize: fontSizePixels.base,
    fontWeight: '600',
    marginBottom: spacingPixels[3],
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacingPixels[2],
  },
  ruleIcon: {
    marginRight: spacingPixels[2],
    marginTop: 2,
  },
  ruleText: {
    fontSize: fontSizePixels.sm,
    flex: 1,
    lineHeight: 20,
  },
  warningText: {
    fontSize: fontSizePixels.xs,
    marginTop: spacingPixels[3],
    lineHeight: 18,
  },
});

export default ChatAgreementActionSheet;
