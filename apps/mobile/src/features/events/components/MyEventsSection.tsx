/**
 * Home's "My events" rail: the tournaments and leagues the caller is committed
 * to right now, as real event cards, right below My Games.
 *
 * Players reported having no idea they were in a tournament unless they went
 * hunting for the My Events button, so this shows the cards themselves rather
 * than another link to them. It draws nothing when the caller has no live
 * event, so Home stays quiet for everyone else.
 */

import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useEventListColors } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import type { EventSummary } from '@rallia/shared-services';

import { lightHaptic } from '../../../utils/haptics';

import { EventSummaryCard } from './EventSummaryCard';

const MAX_CARDS = 5;

interface MyEventsSectionProps {
  events: EventSummary[];
  currentUserId?: string;
  title: string;
  subtitle: string;
  viewAllLabel: string;
  onViewAll: () => void;
  onPressEvent: (event: EventSummary) => void;
}

export const MyEventsSection: React.FC<MyEventsSectionProps> = ({
  events,
  currentUserId,
  title,
  subtitle,
  viewAllLabel,
  onViewAll,
  onPressEvent,
}) => {
  const colors = useEventListColors();
  const { width } = useWindowDimensions();

  if (events.length === 0) return null;

  // A lone card fills the row (same as the favorites rail); with more, each
  // card leaves a sliver of the next one so the rail reads as scrollable.
  const cardWidth = events.length === 1 ? width - spacingPixels[4] * 2 : Math.round(width * 0.82);

  return (
    <View>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text variant="display" size="xl" weight="bold" color={colors.text}>
            {title}
          </Text>
          <Text size="sm" color={colors.textMuted}>
            {subtitle}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.viewAllButton}
          onPress={() => {
            void lightHaptic();
            onViewAll();
          }}
          activeOpacity={0.7}
          testID="my-events-view-all"
        >
          <Text size="base" weight="medium" color={colors.primary}>
            {viewAllLabel}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.primary}
            style={styles.chevron}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {events.slice(0, MAX_CARDS).map(event => (
          <EventSummaryCard
            key={event.id}
            event={event}
            currentUserId={currentUserId}
            onPress={() => onPressEvent(event)}
            style={{ width: cardWidth, marginHorizontal: 0, marginBottom: 0 }}
          />
        ))}
      </ScrollView>
    </View>
  );
};

// Mirrors Home's section chrome (sectionHeader / myMatchesScrollContent) so
// this rail sits on the same rhythm as My Games above it.
const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  sectionHeaderText: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  chevron: {
    marginLeft: spacingPixels[1],
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[3],
  },
});

export default MyEventsSection;
