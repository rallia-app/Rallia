import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { lightHaptic, mediumHaptic } from '@rallia/shared-utils';
import { useThemeStyles, usePlayer, useProfile, useTranslation } from '../../../../hooks';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

export function PlayerInformationActionSheet({ payload }: SheetProps<'player-information'>) {
  const onSave = payload?.onSave;
  const initialData = payload?.initialData;
  const onClose = () => SheetManager.hide('player-information');
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { refetch: refetchPlayer } = usePlayer();
  const { refetch: refetchProfile } = useProfile();
  const [bio, setBio] = useState(initialData?.bio || '');
  const [preferredPlayingHand, setPreferredPlayingHand] = useState<string>(
    initialData?.preferredPlayingHand || ''
  );
  const [maximumTravelDistance, setMaximumTravelDistance] = useState<number>(
    initialData?.maximumTravelDistance || 15
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (isSaving) return;

    mediumHaptic();
    setIsSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsSaving(false);
        toast.error(t('onboarding.validation.playerNotFound'));
        return;
      }

      // Update profile table (bio)
      const { error: profileUpdateError } = await supabase
        .from('profile')
        .update({
          bio: bio,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (profileUpdateError) {
        Logger.error('Failed to update profile', profileUpdateError as Error, { userId: user.id });
        setIsSaving(false);
        toast.error(t('onboarding.validation.failedToUpdateProfile'));
        return;
      }

      // Update player table (playing hand and travel distance)
      const { error: playerUpdateError } = await supabase
        .from('player')
        .update({
          playing_hand: preferredPlayingHand,
          max_travel_distance: maximumTravelDistance,
        })
        .eq('id', user.id);

      if (playerUpdateError) {
        Logger.error('Failed to update player', playerUpdateError as Error, { userId: user.id });
        setIsSaving(false);
        toast.error(t('onboarding.validation.failedToUpdateProfile'));
        return;
      }

      // Refetch player and profile data to update all consumers
      await refetchPlayer();
      await refetchProfile();

      toast.success(t('onboarding.successMessages.playerInfoUpdated'));

      // Notify parent that data was saved successfully
      onSave?.();

      // Close modal automatically after brief delay
      setTimeout(() => {
        SheetManager.hide('player-information');
      }, 500);
    } catch (error) {
      Logger.error('Unexpected error updating player information', error as Error);
      setIsSaving(false);
      toast.error(t('onboarding.validation.unexpectedError'));
    }
  };

  const isFormValid = true;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[styles.sheetBackground, { backgroundColor: colors.card }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCenter}>
            <Text weight="semibold" size="lg" style={{ color: colors.text }}>
              {t('profile.editSheets.playerInfoTitle')}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-outline" size={24} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={[styles.content, { paddingBottom: spacingPixels[8] }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Bio Input */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('profile.bio')}
            </Text>
            <View
              style={[
                styles.input,
                styles.bioInput,
                { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
              ]}
            >
              <TextInput
                placeholder={t('profile.editSheets.bioPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={bio}
                onChangeText={setBio}
                multiline
                numberOfLines={4}
                maxLength={300}
                style={[styles.inputField, styles.bioInputField, { color: colors.text }]}
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Preferred Playing Hand */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('onboarding.preferencesStep.playingHand')}
            </Text>
            <View style={styles.handButtonGroup}>
              <TouchableOpacity
                style={[
                  styles.handOptionButton,
                  {
                    backgroundColor:
                      preferredPlayingHand === 'left' ? colors.primary : colors.inputBackground,
                    borderColor:
                      preferredPlayingHand === 'left' ? colors.primary : colors.inputBorder,
                  },
                ]}
                onPress={() => {
                  lightHaptic();
                  setPreferredPlayingHand('left');
                }}
                activeOpacity={0.8}
              >
                <Text
                  size="sm"
                  weight="semibold"
                  color={
                    preferredPlayingHand === 'left'
                      ? colors.primaryForeground
                      : colors.textSecondary
                  }
                >
                  {t('onboarding.preferencesStep.left')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.handOptionButton,
                  {
                    backgroundColor:
                      preferredPlayingHand === 'right' ? colors.primary : colors.inputBackground,
                    borderColor:
                      preferredPlayingHand === 'right' ? colors.primary : colors.inputBorder,
                  },
                ]}
                onPress={() => {
                  lightHaptic();
                  setPreferredPlayingHand('right');
                }}
                activeOpacity={0.8}
              >
                <Text
                  size="sm"
                  weight="semibold"
                  color={
                    preferredPlayingHand === 'right'
                      ? colors.primaryForeground
                      : colors.textSecondary
                  }
                >
                  {t('onboarding.preferencesStep.right')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.handOptionButton,
                  {
                    backgroundColor:
                      preferredPlayingHand === 'both' ? colors.primary : colors.inputBackground,
                    borderColor:
                      preferredPlayingHand === 'both' ? colors.primary : colors.inputBorder,
                  },
                ]}
                onPress={() => {
                  lightHaptic();
                  setPreferredPlayingHand('both');
                }}
                activeOpacity={0.8}
              >
                <Text
                  size="sm"
                  weight="semibold"
                  color={
                    preferredPlayingHand === 'both'
                      ? colors.primaryForeground
                      : colors.textSecondary
                  }
                >
                  {t('onboarding.preferencesStep.both')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Maximum Travel Distance */}
          <View style={styles.inputContainer}>
            <Text size="sm" weight="semibold" color={colors.text} style={styles.inputLabel}>
              {t('onboarding.preferencesStep.travelDistance')}
            </Text>
            <View
              style={[
                styles.sliderContainer,
                { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
              ]}
            >
              <Text style={[styles.sliderValue, { color: colors.text }]}>
                {maximumTravelDistance} km
              </Text>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={50}
                step={1}
                value={maximumTravelDistance}
                onValueChange={setMaximumTravelDistance}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.divider}
                thumbTintColor={colors.primary}
              />
            </View>
          </View>
        </ScrollView>

        {/* Sticky Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!isFormValid || isSaving) && { opacity: 0.6 },
            ]}
            onPress={handleSave}
            disabled={!isFormValid || isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text weight="semibold" style={{ color: colors.primaryForeground }}>
                {t('common.save')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

export default PlayerInformationActionSheet;

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
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: spacingPixels[1],
    position: 'absolute',
    right: spacingPixels[4],
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
  },
  inputContainer: {
    marginBottom: spacingPixels[4],
  },
  inputLabel: {
    marginBottom: spacingPixels[2],
  },
  input: {
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderWidth: 1,
  },
  bioInput: {
    minHeight: 100,
    paddingVertical: spacingPixels[3],
  },
  inputField: {
    fontSize: 16,
    padding: 0,
  },
  bioInputField: {
    minHeight: 80,
  },
  handButtonGroup: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  handOptionButton: {
    flex: 1,
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sliderContainer: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    borderWidth: 1,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacingPixels[2],
  },
  slider: {
    width: '100%',
    height: 40,
  },
  footer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[4],
    borderTopWidth: 1,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});
