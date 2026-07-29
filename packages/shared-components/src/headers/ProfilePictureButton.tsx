import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useProfile } from '@rallia/shared-hooks';
import { lightHaptic, getProfilePictureUrl } from '@rallia/shared-utils';
import { neutral, spacingPixels } from '@rallia/design-system';

interface ProfilePictureButtonProps {
  size?: number;
  /** Optional custom onPress handler. If provided, this will be used instead of default navigation. */
  onPress?: () => void;
  /** Whether dark mode is active */
  isDark?: boolean;
}

const ProfilePictureButton: React.FC<ProfilePictureButtonProps> = ({
  size = 28,
  onPress,
  isDark = false,
}) => {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { profile, refetch } = useProfile();
  const [imageLoadError, setImageLoadError] = useState(false);

  // Normalize profile picture URL to use current environment's Supabase URL
  const profilePictureUrl = useMemo(
    () => getProfilePictureUrl(profile?.profile_picture_url),
    [profile?.profile_picture_url]
  );
  const iconColor = isDark ? neutral[50] : neutral[900];
  const placeholderBg = isDark ? neutral[700] : neutral[200];

  useEffect(() => {
    if (profile) {
      setImageLoadError(false);
    }
  }, [profile, profilePictureUrl]);

  // Refetch profile when the screen comes into focus, at most once per
  // 5 minutes. Unthrottled, every tab switch/back-navigation fired a profile
  // fetch whose loading-state flips re-rendered every ProfileContext consumer
  // mid-transition. In-app edits update the context directly, so the focus
  // refetch only exists to catch cross-device changes.
  const lastFocusRefetchRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFocusRefetchRef.current < 5 * 60 * 1000) return;
      lastFocusRefetchRef.current = now;
      refetch();
    }, [refetch])
  );

  const handlePress = () => {
    lightHaptic();
    if (onPress) {
      onPress();
    } else {
      navigation.navigate('UserProfile');
    }
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handlePress}>
      {profilePictureUrl && !imageLoadError ? (
        <Image
          source={{ uri: profilePictureUrl }}
          style={[
            styles.profileImage,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: placeholderBg,
            },
          ]}
          onError={() => setImageLoadError(true)}
        />
      ) : (
        <Ionicons name="person-circle-outline" size={size + 6} color={iconColor} />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    padding: spacingPixels[1],
    marginLeft: spacingPixels[2],
  },
  profileImage: {},
});

export default ProfilePictureButton;
