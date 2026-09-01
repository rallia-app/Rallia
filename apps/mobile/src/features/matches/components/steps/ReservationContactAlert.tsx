/**
 * Reservation Contact Alert
 *
 * Shown in the Where step when the selected facility still needs to be called,
 * emailed, or booked online before the game can be confirmed.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import type { TranslationKey, TranslationOptions } from '#/hooks/useTranslation';

interface ReservationContactAlertProps {
  phone: string | null;
  email: string | null;
  website: string | null;
  colors: { buttonTextActive: string };
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
}

export const ReservationContactAlert: React.FC<ReservationContactAlertProps> = ({
  phone,
  email,
  website,
  colors,
  t,
  isDark,
}) => {
  // Use accent color (amber/gold) for distinct alert styling
  const alertColor = isDark ? accent[400] : accent[600];
  const alertBgColor = isDark ? `${accent[500]}15` : accent[50];
  const alertTextColor = isDark ? accent[200] : accent[800];
  const buttonBgColor = isDark ? accent[500] : accent[600];

  const handleCall = () => {
    if (phone) {
      lightHaptic();
      Linking.openURL(`tel:${phone}`);
    }
  };

  const handleEmail = () => {
    if (email) {
      lightHaptic();
      Linking.openURL(`mailto:${email}`);
    }
  };

  const handleWebsite = () => {
    if (website) {
      lightHaptic();
      // Ensure website has protocol
      const url = website.startsWith('http') ? website : `https://${website}`;
      Linking.openURL(url);
    }
  };

  return (
    <View
      style={[styles.reservationAlert, { backgroundColor: alertBgColor, borderColor: alertColor }]}
    >
      <View style={styles.reservationAlertHeader}>
        <Ionicons name="calendar-outline" size={20} color={alertColor} />
        <Text size="base" weight="semibold" color={alertColor}>
          {t('matchCreation.fields.reservationContactTitle')}
        </Text>
      </View>
      <Text size="sm" color={alertTextColor} style={styles.reservationAlertDescription}>
        {t('matchCreation.fields.reservationContactDescription')}
      </Text>
      <View style={styles.reservationAlertActions}>
        {phone && (
          <TouchableOpacity
            style={[styles.reservationActionButton, { backgroundColor: buttonBgColor }]}
            onPress={handleCall}
            activeOpacity={0.8}
          >
            <Ionicons name="call-outline" size={16} color={colors.buttonTextActive} />
            <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
              {t('matchCreation.fields.callFacility')}
            </Text>
          </TouchableOpacity>
        )}
        {email && (
          <TouchableOpacity
            style={[styles.reservationActionButton, { backgroundColor: buttonBgColor }]}
            onPress={handleEmail}
            activeOpacity={0.8}
          >
            <Ionicons name="mail-outline" size={16} color={colors.buttonTextActive} />
            <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
              {t('matchCreation.fields.emailFacility')}
            </Text>
          </TouchableOpacity>
        )}
        {website && (
          <TouchableOpacity
            style={[styles.reservationActionButton, { backgroundColor: buttonBgColor }]}
            onPress={handleWebsite}
            activeOpacity={0.8}
          >
            <Ionicons name="globe-outline" size={16} color={colors.buttonTextActive} />
            <Text size="sm" weight="semibold" color={colors.buttonTextActive}>
              {t('matchCreation.fields.visitWebsite')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  reservationAlert: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[5],
  },
  reservationAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  reservationAlertDescription: {
    marginBottom: spacingPixels[3],
  },
  reservationAlertActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  reservationActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.md,
  },
});

export default ReservationContactAlert;
