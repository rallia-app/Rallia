import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { lightHaptic } from '@rallia/shared-utils';

interface SettingsButtonProps {
  size?: number;
  color?: string;
}

const SettingsButton: React.FC<SettingsButtonProps> = ({ size = 24, color = '#333' }) => {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const handlePress = () => {
    lightHaptic();
    navigation.navigate('Settings');
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handlePress}>
      <Ionicons name="settings-outline" size={size} color={color} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
});

export default SettingsButton;
