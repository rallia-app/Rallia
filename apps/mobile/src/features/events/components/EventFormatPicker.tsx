/**
 * "What do you want to organize?" — the first step of event creation.
 *
 * The choice used to be split across two menu items and a field buried on step
 * 2 of the tournament wizard. Here it is one screen of full-bleed cards in the
 * event banner language (brand gradient, oversized glyph, scrimmed white
 * text), the same visual treatment as pre-onboarding's sport picker.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text, WizardHeader, WizardFooter, type WizardColors } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, secondary, accent } from '@rallia/design-system';
import { selectionHaptic } from '@rallia/shared-utils';

import { useTranslation } from '../../../hooks';
import { SportIcon } from '../../../components/SportIcon';
import { EVENT_KINDS, type EventKind } from '../eventKinds';

const BASE_WHITE = '#ffffff';

/** Card art per format: the event banner palette (tournaments teal, leagues
 *  coral) plus gold for the middle format, so the three read as siblings of
 *  the default banners rather than a new visual system. */
const KIND_ART: Record<EventKind, { gradient: [string, string] }> = {
  knockout: { gradient: [primary[400], primary[700]] },
  pools_knockout: { gradient: [accent[400], accent[600]] },
  session_league: { gradient: [secondary[400], secondary[600]] },
};

interface EventFormatPickerProps {
  /** Restricts the offered formats; defaults to all of them. */
  kinds?: EventKind[];
  selected: EventKind | null;
  onSelect: (kind: EventKind) => void;
  onContinue: () => void;
  onBack: () => void;
  onClose: () => void;
  sportName: string;
  sportKey: string;
  colors: WizardColors & { text: string; textMuted: string };
}

export const EventFormatPicker: React.FC<EventFormatPickerProps> = ({
  kinds,
  selected,
  onSelect,
  onContinue,
  onBack,
  onClose,
  sportName,
  sportKey,
  colors,
}) => {
  const { t } = useTranslation();
  const offered = kinds ? EVENT_KINDS.filter(d => kinds.includes(d.kind)) : EVENT_KINDS;

  return (
    <View style={styles.container}>
      <WizardHeader
        onBack={onBack}
        onClose={onClose}
        badgeIcon={<SportIcon sportName={sportKey} size={14} color={BASE_WHITE} />}
        badgeLabel={sportName}
        colors={colors}
        backAccessibilityLabel={t('common.back')}
        closeAccessibilityLabel={t('common.close')}
      />

      <View style={styles.body}>
        <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.header}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('eventCreation.pickerTitle')}
          </Text>
          <Text size="sm" color={colors.textMuted}>
            {t('eventCreation.pickerDescription')}
          </Text>
        </Animated.View>

        <View style={styles.options}>
          {offered.map((descriptor, index) => {
            const art = KIND_ART[descriptor.kind];
            const isSelected = selected === descriptor.kind;
            return (
              <Animated.View
                key={descriptor.kind}
                entering={FadeInDown.delay(150 + index * 100).springify()}
                style={styles.option}
              >
                {/* Selection ring in the app primary, the colour every other
                    selected control wears, offset from the card by a gap of
                    sheet background so it reads even on the teal card. The
                    transparent border is always drawn, so selecting never
                    resizes the card. */}
                <TouchableOpacity
                  style={[
                    styles.ringWrap,
                    isSelected && {
                      borderColor: colors.buttonActive,
                      shadowColor: colors.buttonActive,
                    },
                  ]}
                  onPress={() => {
                    void selectionHaptic();
                    onSelect(descriptor.kind);
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={t(descriptor.titleKey)}
                  testID={`event-format-${descriptor.kind}`}
                >
                  <View style={styles.card}>
                    {/* Banner-language backdrop: brand gradient, soft circles,
                      an oversized translucent glyph off the corner. */}
                    <LinearGradient
                      colors={art.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    >
                      <View style={[styles.decorCircle, styles.decorCircleLarge]} />
                      <View style={[styles.decorCircle, styles.decorCircleSmall]} />
                      <Ionicons
                        name={descriptor.icon}
                        size={104}
                        color="rgba(255,255,255,0.22)"
                        style={styles.decorGlyph}
                      />
                    </LinearGradient>

                    {/* Scrim so the white text reads over the gradient art. */}
                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.55)']}
                      style={styles.scrim}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                    />

                    <View style={styles.info}>
                      <View style={styles.titleRow}>
                        <Text size="xl" weight="bold" color={BASE_WHITE} style={styles.title}>
                          {t(descriptor.titleKey)}
                        </Text>
                        {isSelected ? (
                          <View
                            style={[
                              styles.selectionBadge,
                              { backgroundColor: colors.buttonActive },
                            ]}
                          >
                            <Ionicons name="checkmark-outline" size={18} color={BASE_WHITE} />
                          </View>
                        ) : (
                          <View style={styles.selectRing}>
                            <Ionicons name="add-outline" size={20} color={BASE_WHITE} />
                          </View>
                        )}
                      </View>
                      <Text size="xs" color="rgba(255,255,255,0.92)" numberOfLines={2}>
                        {t(descriptor.descriptionKey)}
                      </Text>
                      <Text
                        size="xs"
                        weight="semibold"
                        color="rgba(255,255,255,0.78)"
                        style={styles.facts}
                        numberOfLines={2}
                      >
                        {descriptor.factKeys.map(key => t(key)).join(' · ')}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
      </View>

      <WizardFooter
        label={t('eventCreation.continue')}
        onPress={onContinue}
        disabled={selected == null}
        trailingIcon="arrow"
        colors={colors}
        testID="event-format-continue"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  body: {
    flex: 1,
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  header: {
    marginBottom: spacingPixels[4],
    gap: spacingPixels[0.5],
  },
  options: {
    flex: 1,
    gap: spacingPixels[3],
  },
  /** Equal share of the free space, so the three formats read as peers. */
  option: {
    flex: 1,
  },
  ringWrap: {
    flex: 1,
    minHeight: 132,
    borderWidth: 2.5,
    borderColor: 'transparent',
    borderRadius: radiusPixels.xl + 5,
    padding: 2.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  card: {
    flex: 1,
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  decorCircle: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
  },
  decorCircleLarge: {
    width: 190,
    height: 190,
    top: -70,
    left: -50,
  },
  decorCircleSmall: {
    width: 110,
    height: 110,
    bottom: -30,
    right: 90,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  decorGlyph: {
    position: 'absolute',
    top: -12,
    right: -8,
    transform: [{ rotate: '-12deg' }],
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '75%',
  },
  info: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacingPixels[3.5],
    gap: spacingPixels[0.5],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  title: {
    flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  facts: {
    marginTop: spacingPixels[0.5],
  },
  selectionBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  selectRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
});
