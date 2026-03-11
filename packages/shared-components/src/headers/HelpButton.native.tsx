import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { lightHaptic } from '@rallia/shared-utils';

interface HelpButtonProps {
  size?: number;
  color?: string;
}

/**
 * Help button that navigates to the Feedback & Suggestions screen.
 * Placed in the app header near settings for easy access to bug reporting.
 */
const HelpButton: React.FC<HelpButtonProps> = ({ size = 24, color = '#333' }) => {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const handlePress = () => {
    void lightHaptic();
    navigation.navigate('Feedback');
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handlePress}>
      <Ionicons name="help-circle-outline" size={size} color={color} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
});

export default HelpButton;
