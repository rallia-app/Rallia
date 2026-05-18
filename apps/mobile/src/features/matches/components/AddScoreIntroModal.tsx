/**
 * Add Score Introduction Modal
 *
 * A full-screen modal explaining the score tracking feature.
 * Shows on first use with option to never show again.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, ImageBackground } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@rallia/shared-components';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation, type TranslationKey } from '../../../hooks';

interface AddScoreIntroModalProps {
  visible: boolean;
  onClose: () => void;
  onAddScore: () => void;
  onNeverShowAgain: () => void;
}

export function AddScoreIntroModal({
  visible,
  onClose,
  onAddScore,
  onNeverShowAgain,
}: AddScoreIntroModalProps) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Tennis image background */}
        <ImageBackground
          source={require('../../../../assets/images/tennis.webp')}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          {/* Dark overlay gradient for text readability */}
          <LinearGradient colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)']} style={styles.overlay}>
            {/* Close button */}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-outline" size={28} color="#FFFFFF" />
            </TouchableOpacity>

            {/* Content */}
            <View style={styles.content}>
              {/* Title */}
              <Text weight="bold" size="2xl" style={styles.title}>
                {t('addScore.intro.title')}
              </Text>

              {/* Accent line */}
              <View style={styles.accentLine} />

              {/* Description */}
              <Text size="base" style={styles.description}>
                {t('addScore.intro.description')}
              </Text>

              {/* How to add scores */}
              <Text size="base" style={styles.howToTitle}>
                {t('addScore.intro.howToTitle')}
              </Text>

              <View style={styles.bulletPoints}>
                <Text size="base" style={styles.bulletPoint}>
                  • {t('addScore.intro.step1')}
                </Text>
                <Text size="base" style={styles.bulletPoint}>
                  • {t('addScore.intro.step2')}
                </Text>
                <Text size="base" style={styles.bulletPoint}>
                  • {t('addScore.intro.step3')}
                </Text>
                <Text size="base" style={styles.bulletPoint}>
                  • {t('addScore.intro.step4')}
                </Text>
              </View>

              {/* Confirmation note */}
              <Text size="base" style={styles.confirmationNote}>
                {t('addScore.intro.confirmationNote')}
              </Text>
            </View>

            {/* Bottom buttons */}
            <View style={styles.bottomButtons}>
              <Button variant="primary" onPress={onAddScore} style={styles.addScoreButton}>
                {t('addScore.intro.addScoreNow')}
              </Button>

              <TouchableOpacity style={styles.neverShowButton} onPress={onNeverShowAgain}>
                <Text size="base" style={styles.neverShowText}>
                  {t('addScore.intro.neverShowAgain')}
                </Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </ImageBackground>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlay: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 4,
  },
  content: {
    flex: 1,
    paddingTop: 20,
  },
  title: {
    color: '#FFFFFF',
    marginBottom: 12,
  },
  accentLine: {
    width: 40,
    height: 4,
    backgroundColor: '#4DA6C2',
    borderRadius: 2,
    marginBottom: 24,
  },
  description: {
    color: '#FFFFFF',
    lineHeight: 24,
    marginBottom: 24,
  },
  howToTitle: {
    color: '#FFFFFF',
    marginBottom: 12,
  },
  bulletPoints: {
    marginBottom: 24,
  },
  bulletPoint: {
    color: '#FFFFFF',
    lineHeight: 26,
    marginBottom: 4,
  },
  confirmationNote: {
    color: '#B8D4E3',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  bottomButtons: {
    paddingBottom: 40,
  },
  addScoreButton: {
    marginBottom: 16,
  },
  neverShowButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  neverShowText: {
    color: '#FFFFFF',
  },
});
