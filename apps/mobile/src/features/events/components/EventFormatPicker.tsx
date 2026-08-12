/**
 * "What do you want to organize?" — the first step of event creation.
 *
 * The choice used to be split across two menu items and a field buried on step
 * 2 of the tournament wizard. Here it is one screen, with the trade-offs the
 * spec's format table puts side by side.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import {
  Text,
  WizardHeader,
  WizardOptionCard,
  WizardFooter,
  type WizardColors,
} from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';

import { useTranslation } from '../../../hooks';
import { SportIcon } from '../../../components/SportIcon';
import { EVENT_KINDS, type EventKind } from '../eventKinds';

const BASE_WHITE = '#ffffff';

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

      <SheetScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('eventCreation.pickerTitle')}
          </Text>
          <Text size="sm" color={colors.textMuted}>
            {t('eventCreation.pickerDescription')}
          </Text>
        </View>

        <View style={styles.options}>
          {offered.map(descriptor => (
            <WizardOptionCard
              key={descriptor.kind}
              icon={descriptor.icon}
              title={t(descriptor.titleKey)}
              description={t(descriptor.descriptionKey)}
              facts={descriptor.factKeys.map(key => t(key))}
              selected={selected === descriptor.kind}
              onPress={() => onSelect(descriptor.kind)}
              colors={colors}
              style={styles.option}
              testID={`event-format-${descriptor.kind}`}
            />
          ))}
        </View>
      </SheetScrollView>

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
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
    // Lets the cards share whatever height is left below the heading.
    flexGrow: 1,
  },
  header: {
    marginBottom: spacingPixels[5],
  },
  options: {
    flex: 1,
    gap: spacingPixels[3],
  },
  /** Equal share of the free space, so the three formats read as peers. */
  option: {
    flex: 1,
  },
});
