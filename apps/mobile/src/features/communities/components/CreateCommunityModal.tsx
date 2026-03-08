/**
 * CreateCommunityModal
 * Modal for creating a new community with visibility toggle
 */

import { useState, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
  Switch,
  ScrollView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';

import { Text, useToast } from '@rallia/shared-components';
import { useRequireOnboarding, useThemeStyles, useTranslation } from '../../../hooks';
import { uploadImage } from '../../../services/imageUpload';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { useCreateCommunity, useSports } from '@rallia/shared-hooks';

type SportOption = 'both' | 'tennis' | 'pickleball';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { CommunityStackParamList } from '../../../navigation/types';

export function CreateCommunityActionSheet({ payload }: SheetProps<'create-community'>) {
  const playerId = payload?.playerId;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const navigation = useNavigation<NavigationProp<CommunityStackParamList>>();
  const toast = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [selectedSport, setSelectedSport] = useState<SportOption>('both');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCommunityMutation = useCreateCommunity();
  const { sports } = useSports();

  // Get the sport_id based on selection (null = both sports)
  const getSportId = useMemo(() => {
    return () => {
      if (selectedSport === 'both') return null;
      const sport = sports?.find(s => s.name.toLowerCase() === selectedSport.toLowerCase());
      return sport?.id ?? null;
    };
  }, [selectedSport, sports]);

  const handleCreateCommunity = useCallback(
    async (
      name: string,
      description?: string,
      coverImageUrl?: string,
      isPublic: boolean = true,
      sportId: string | null = null
    ) => {
      if (!guardAction()) return;

      try {
        const newCommunity = await createCommunityMutation.mutateAsync({
          playerId: playerId!,
          input: {
            name,
            description,
            cover_image_url: coverImageUrl,
            is_public: isPublic,
            sport_id: sportId,
          },
        });
        // Close modal first
        await SheetManager.hide('create-community');
        // Show success toast
        toast.success(t('community.success.created'));
        // Navigate to the new community
        navigation.navigate('CommunityDetail', { communityId: newCommunity.id });
      } catch (error) {
        Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create community');
      }
    },
    [guardAction, playerId, createCommunityMutation, navigation, toast, t]
  );

  const handlePickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('community.permissionRequired'), t('community.photoAccessRequired'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setCoverImage(result.assets[0].uri);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      Alert.alert(t('common.error'), t('community.failedToPickImage'));
    }
  }, [t]);

  const handleRemoveImage = useCallback(() => {
    setCoverImage(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setError(t('community.nameRequired'));
      return;
    }

    if (name.trim().length < 2) {
      setError(t('community.nameTooShort'));
      return;
    }

    if (name.trim().length > 100) {
      setError(t('community.nameTooLong'));
      return;
    }

    setError(null);

    let coverImageUrl: string | undefined;

    if (coverImage) {
      setIsUploadingImage(true);
      try {
        // Use 'group-images' bucket as it's shared for network cover images
        const { url, error: uploadError } = await uploadImage(coverImage, 'group-images');
        if (uploadError) {
          console.error('Error uploading image:', uploadError);
          Alert.alert(t('common.warning'), t('community.failedToUploadImage'));
        } else if (url) {
          coverImageUrl = url;
        }
      } catch (err) {
        console.error('Error uploading image:', err);
      } finally {
        setIsUploadingImage(false);
      }
    }

    await handleCreateCommunity(
      name.trim(),
      description.trim() || undefined,
      coverImageUrl,
      isPublic,
      getSportId()
    );
    setName('');
    setDescription('');
    setCoverImage(null);
    setIsPublic(true);
    setSelectedSport('both');
  }, [name, description, coverImage, isPublic, t, getSportId]);

  const handleClose = useCallback(() => {
    setName('');
    setDescription('');
    setCoverImage(null);
    setIsPublic(true);
    setSelectedSport('both');
    setError(null);
    SheetManager.hide('create-community');
  }, []);

  const isSubmitting = isLoading || isUploadingImage;

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        styles.container,
        { backgroundColor: colors.cardBackground },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCenter}>
          <Text weight="semibold" size="lg" style={{ color: colors.text }}>
            {t('community.createCommunity')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inputGroup}>
          <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
            {t('community.communityImage')}
          </Text>
          {coverImage ? (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: coverImage }} style={styles.imagePreview} />
              <TouchableOpacity
                style={[styles.removeImageButton, { backgroundColor: colors.cardBackground }]}
                onPress={handleRemoveImage}
              >
                <Ionicons name="close-outline" size={20} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.changeImageButton, { backgroundColor: colors.primary }]}
                onPress={handlePickImage}
              >
                <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
                <Text size="xs" weight="semibold" style={{ color: '#FFFFFF', marginLeft: 4 }}>
                  {t('common.change')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.imagePicker,
                {
                  backgroundColor: isDark ? primary[900] : primary[100],
                  borderColor: colors.border,
                },
              ]}
              onPress={handlePickImage}
            >
              <View style={[styles.imagePickerIcon, { backgroundColor: colors.cardBackground }]}>
                <Ionicons name="camera-outline" size={24} color={colors.primary} />
              </View>
              <Text size="sm" style={{ color: colors.textSecondary, marginTop: 8 }}>
                {t('community.addCoverImage')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('community.communityName')} *
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {name.length}/100
            </Text>
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: error ? '#FF3B30' : colors.border,
              },
            ]}
            placeholder={t('community.enterCommunityName')}
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            maxLength={100}
          />
          {error && (
            <Text size="xs" style={{ color: '#FF3B30', marginTop: 4 }}>
              {error}
            </Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.labelRow}>
            <Text weight="medium" size="sm" style={{ color: colors.text }}>
              {t('community.descriptionOptional')}
            </Text>
            <Text size="xs" style={{ color: colors.textMuted }}>
              {description.length}/500
            </Text>
          </View>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder={t('community.descriptionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <View
          style={[styles.visibilityToggle, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}
        >
          <View style={styles.visibilityLeft}>
            <View
              style={[
                styles.visibilityIcon,
                { backgroundColor: isPublic ? '#34C75920' : '#FF950020' },
              ]}
            >
              <Ionicons
                name={isPublic ? 'globe-outline' : 'lock-closed-outline'}
                size={24}
                color={isPublic ? '#34C759' : '#FF9500'}
              />
            </View>
            <View style={styles.visibilityText}>
              <Text weight="semibold" size="sm" style={{ color: colors.text }}>
                {isPublic ? t('community.publicCommunity') : t('community.privateCommunity')}
              </Text>
              <Text size="xs" style={{ color: colors.textSecondary, marginTop: 2 }}>
                {isPublic ? t('community.publicDescription') : t('community.privateDescription')}
              </Text>
            </View>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: '#767577', true: colors.primary + '80' }}
            thumbColor={isPublic ? colors.primary : '#f4f3f4'}
          />
        </View>

        {/* Sport Selection */}
        <View style={styles.inputGroup}>
          <Text weight="medium" size="sm" style={{ color: colors.text, marginBottom: 8 }}>
            {t('community.sportSelection')}
          </Text>
          <View style={styles.sportOptions}>
            <TouchableOpacity
              style={[
                styles.sportOption,
                {
                  backgroundColor:
                    selectedSport === 'both'
                      ? isDark
                        ? primary[900]
                        : primary[50]
                      : colors.inputBackground,
                  borderColor: selectedSport === 'both' ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedSport('both')}
            >
              <View style={styles.sportOptionIcons}>
                <MaterialCommunityIcons
                  name="tennis"
                  size={20}
                  color={selectedSport === 'both' ? colors.primary : colors.textMuted}
                />
                <Text style={{ color: colors.textMuted, marginHorizontal: 2 }}>+</Text>
                <MaterialCommunityIcons
                  name="badminton"
                  size={20}
                  color={selectedSport === 'both' ? colors.primary : colors.textMuted}
                />
              </View>
              <Text
                size="xs"
                weight={selectedSport === 'both' ? 'semibold' : 'regular'}
                style={{
                  color: selectedSport === 'both' ? colors.primary : colors.textSecondary,
                  marginTop: 4,
                }}
              >
                {t('community.sportBoth')}
              </Text>
              {selectedSport === 'both' && (
                <View style={[styles.sportOptionCheck, { backgroundColor: colors.primary }]}>
                  <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sportOption,
                {
                  backgroundColor:
                    selectedSport === 'tennis'
                      ? isDark
                        ? primary[900]
                        : primary[50]
                      : colors.inputBackground,
                  borderColor: selectedSport === 'tennis' ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedSport('tennis')}
            >
              <MaterialCommunityIcons
                name="tennis"
                size={24}
                color={selectedSport === 'tennis' ? colors.primary : colors.textMuted}
              />
              <Text
                size="xs"
                weight={selectedSport === 'tennis' ? 'semibold' : 'regular'}
                style={{
                  color: selectedSport === 'tennis' ? colors.primary : colors.textSecondary,
                  marginTop: 4,
                }}
              >
                {t('community.sportTennis')}
              </Text>
              {selectedSport === 'tennis' && (
                <View style={[styles.sportOptionCheck, { backgroundColor: colors.primary }]}>
                  <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sportOption,
                {
                  backgroundColor:
                    selectedSport === 'pickleball'
                      ? isDark
                        ? primary[900]
                        : primary[50]
                      : colors.inputBackground,
                  borderColor: selectedSport === 'pickleball' ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedSport('pickleball')}
            >
              <MaterialCommunityIcons
                name="badminton"
                size={24}
                color={selectedSport === 'pickleball' ? colors.primary : colors.textMuted}
              />
              <Text
                size="xs"
                weight={selectedSport === 'pickleball' ? 'semibold' : 'regular'}
                style={{
                  color: selectedSport === 'pickleball' ? colors.primary : colors.textSecondary,
                  marginTop: 4,
                }}
              >
                {t('community.sportPickleball')}
              </Text>
              {selectedSport === 'pickleball' && (
                <View style={[styles.sportOptionCheck, { backgroundColor: colors.primary }]}>
                  <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          </View>
          <Text size="xs" style={{ color: colors.textMuted, marginTop: 6 }}>
            {t('community.sportSelectionHint')}
          </Text>
        </View>

        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
          <Ionicons name="information-circle" size={20} color={colors.primary} />
          <Text size="sm" style={{ color: colors.textSecondary, flex: 1, marginLeft: 8 }}>
            {t('community.createInfo')}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: colors.primary },
            isSubmitting && { opacity: 0.7 },
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || !name.trim()}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.buttonTextActive} />
          ) : (
            <Text size="lg" weight="semibold" color={colors.buttonTextActive}>
              {t('common.confirm')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ActionSheet>
  );
}

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
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerCenter: {
    alignItems: 'center',
  },
  closeButton: {
    padding: 4,
    position: 'absolute',
    right: 16,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    flex: 0,
    padding: 16,
    gap: 20,
  },
  inputGroup: {
    gap: 0,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  imagePicker: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePickerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 120,
    borderRadius: 12,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  changeImageButton: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  visibilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
  },
  visibilityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  visibilityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  visibilityText: {
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
  },
  sportOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  sportOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    position: 'relative',
    minHeight: 70,
  },
  sportOptionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sportOptionCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: spacingPixels[4],
    borderTopWidth: 1,
    paddingBottom: spacingPixels[4],
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
