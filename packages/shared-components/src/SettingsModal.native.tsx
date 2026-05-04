import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '@rallia/shared-services';
import { useProfile } from '@rallia/shared-hooks';
import { getHumanName, getProfilePictureUrl } from '@rallia/shared-utils';
import { Text } from './foundation/Text.native';
import { Heading } from './foundation/Heading.native';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const { width } = Dimensions.get('window');

const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose }) => {
  const navigation = useNavigation();
  const [slideAnim] = useState(new Animated.Value(width));
  const [selectedLanguage, setSelectedLanguage] = useState<'EN' | 'FR'>('EN');
  const [selectedAppearance, setSelectedAppearance] = useState<'Light' | 'Dark' | 'System'>(
    'Light'
  );

  // Use custom hook for profile data
  const { profile, refetch: refetchProfile } = useProfile();

  // Extract user data from profile
  const userName = getHumanName(profile, '');
  const userEmail = profile?.email || '';
  const profilePictureUrl = getProfilePictureUrl(profile?.profile_picture_url) || null;

  useEffect(() => {
    if (visible) {
      // Slide in
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();

      // Refetch user data when modal opens
      refetchProfile();
    } else {
      // Slide out
      Animated.timing(slideAnim, {
        toValue: width,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim, refetchProfile]);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      onClose();
      // Navigate to Home after successful sign out
      (navigation as { navigate: (screen: string) => void }).navigate('Home');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleDeleteAccount = () => {
    // TODO: Implement delete account functionality
  };

  const SettingsItem = ({
    icon,
    title,
    onPress,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity style={styles.settingsItem} onPress={onPress}>
      <View style={styles.settingsItemLeft}>
        <Ionicons name={icon} size={18} color="#666" />
        <Text size="sm">{title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#999" />
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View
          style={[
            styles.modalContent,
            {
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="chevron-back" size={24} color="#333" />
            </TouchableOpacity>
            <Heading level={3}>Settings</Heading>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* User Profile Card */}
            <View style={styles.profileCard}>
              {/* User Profile Section */}
              <View style={styles.profileSection}>
                {profilePictureUrl ? (
                  <Image source={{ uri: profilePictureUrl }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="person" size={24} color="#999" />
                  </View>
                )}
                <View style={styles.profileInfo}>
                  <Text weight="semibold" size="base">
                    {userName}
                  </Text>
                  <Text variant="caption" color="#666">
                    {userEmail}
                  </Text>
                </View>
              </View>

              {/* Edit Profile */}
              <TouchableOpacity
                style={styles.editProfileButton}
                onPress={() => {
                  onClose(); // Close settings modal first
                  navigation.navigate('UserProfile' as never);
                }}
              >
                <Ionicons name="create-outline" size={16} color="#666" />
                <Text size="sm">Edit Profile</Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color="#999"
                  style={{ marginLeft: 'auto' }}
                />
              </TouchableOpacity>
            </View>

            {/* Settings Items */}
            <View style={styles.settingsGroup}>
              <SettingsItem
                icon="notifications-outline"
                title="Notifications"
                onPress={() => console.log('Notifications pressed')}
              />
              <SettingsItem
                icon="lock-closed-outline"
                title="Permissions"
                onPress={() => console.log('Permissions pressed')}
              />
              <SettingsItem
                icon="card-outline"
                title="Subscription"
                onPress={() => console.log('Subscription pressed')}
              />
              <SettingsItem
                icon="wallet-outline"
                title="Payments"
                onPress={() => console.log('Payments pressed')}
              />
              <SettingsItem
                icon="help-circle-outline"
                title="Help & Assistance"
                onPress={() => console.log('Help pressed')}
              />
              <SettingsItem
                icon="document-text-outline"
                title="Terms & Conditions"
                onPress={() => console.log('Terms pressed')}
              />
            </View>

            {/* Preferred Language */}
            <View style={styles.preferenceSection}>
              <Text variant="caption" color="#666">
                Preferred language
              </Text>
              <View style={styles.preferenceOptions}>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    selectedLanguage === 'EN' && styles.preferenceButtonActive,
                  ]}
                  onPress={() => setSelectedLanguage('EN')}
                >
                  <Text
                    size="xs"
                    weight={selectedLanguage === 'EN' ? 'semibold' : 'medium'}
                    color={selectedLanguage === 'EN' ? '#fff' : '#666'}
                  >
                    EN
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    selectedLanguage === 'FR' && styles.preferenceButtonActive,
                  ]}
                  onPress={() => setSelectedLanguage('FR')}
                >
                  <Text
                    size="xs"
                    weight={selectedLanguage === 'FR' ? 'semibold' : 'medium'}
                    color={selectedLanguage === 'FR' ? '#fff' : '#666'}
                  >
                    FR
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Appearance */}
            <View style={styles.preferenceSection}>
              <Text variant="caption" color="#666">
                Appearance
              </Text>
              <View style={styles.preferenceOptions}>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    selectedAppearance === 'Light' && styles.preferenceButtonActive,
                  ]}
                  onPress={() => setSelectedAppearance('Light')}
                >
                  <Text
                    size="xs"
                    weight={selectedAppearance === 'Light' ? 'semibold' : 'medium'}
                    color={selectedAppearance === 'Light' ? '#fff' : '#666'}
                  >
                    Light
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    selectedAppearance === 'Dark' && styles.preferenceButtonActive,
                  ]}
                  onPress={() => setSelectedAppearance('Dark')}
                >
                  <Text
                    size="xs"
                    weight={selectedAppearance === 'Dark' ? 'semibold' : 'medium'}
                    color={selectedAppearance === 'Dark' ? '#fff' : '#666'}
                  >
                    Dark
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    selectedAppearance === 'System' && styles.preferenceButtonActive,
                  ]}
                  onPress={() => setSelectedAppearance('System')}
                >
                  <Text
                    size="xs"
                    weight={selectedAppearance === 'System' ? 'semibold' : 'medium'}
                    color={selectedAppearance === 'System' ? '#fff' : '#666'}
                  >
                    System
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Sign Out & Delete Account */}
            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
                <Ionicons name="log-out-outline" size={18} color="#000" />
                <Text size="sm">Sign Out</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount}>
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                <Text size="sm" color="#FF3B30">
                  Delete Account
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: width,
    backgroundColor: '#C8F2EF',
    shadowColor: '#000',
    shadowOffset: {
      width: -2,
      height: 0,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 16,
    backgroundColor: '#C8F2EF',
  },
  backButton: {
    padding: 4,
  },
  scrollContent: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  profileCard: {
    backgroundColor: '#E8F8F5',
    marginBottom: 16,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: '#E8F8F5',
  },
  profileImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E0E0E0',
  },
  profileImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    marginLeft: 12,
    flex: 1,
  },
  editProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#E8F8F5',
    borderTopWidth: 0.5,
    borderTopColor: '#E0E0E0',
    gap: 8,
  },
  settingsGroup: {
    backgroundColor: '#E8F8F5',
    marginBottom: 16,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#E8F8F5',
    borderBottomWidth: 0.5,
    borderBottomColor: '#E0E0E0',
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  preferenceSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#E8F8F5',
    marginBottom: 16,
  },
  preferenceOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  preferenceButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    minWidth: 60,
    alignItems: 'center',
  },
  preferenceButtonActive: {
    backgroundColor: '#0D9488',
  },
  actionButtons: {
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: '#E8F8F5',
    gap: 0,
    marginBottom: 16,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#E8F8F5',
    borderTopWidth: 0.5,
    borderTopColor: '#E0E0E0',
    gap: 8,
  },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#E8F8F5',
    borderTopWidth: 0.5,
    borderTopColor: '#E0E0E0',
    gap: 8,
  },
});

export default SettingsModal;
