/**
 * EventListScaffold — the list frame every event format's discovery screen
 * uses: sectioned FlatList, pull-to-refresh live in every state, and the
 * loading / error / empty branches.
 *
 * Screens own fetching and grouping; this owns rendering. Cards come in via
 * `renderCard`, so a format's card stays the format's business.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  EmptyState,
  Text,
  EventCardSkeleton,
  useEventListColors,
} from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';

import { useTranslation, useScrollBottomInset, type TranslationKey } from '../../../hooks';

export interface EventListSection<T> {
  titleKey: TranslationKey;
  items: T[];
}

interface EventListScaffoldProps<T> {
  sections: EventListSection<T>[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyTitleKey: TranslationKey;
  emptyDescriptionKey: TranslationKey;
  loadErrorKey: TranslationKey;
  retryKey: TranslationKey;
  /** Rendered above the list content in every state (e.g. a nav button). */
  header?: React.ReactNode;
  /** The format's card. */
  renderCard: (item: T) => React.ReactNode;
  /** Banner width:height, so the loading placeholders match the real card. */
  skeletonBannerAspect: number;
}

export function EventListScaffold<T extends { id: string }>({
  sections,
  isLoading,
  isError,
  refetch,
  emptyIcon = 'trophy-outline',
  emptyTitleKey,
  emptyDescriptionKey,
  loadErrorKey,
  retryKey,
  header,
  renderCard,
  skeletonBannerAspect,
}: EventListScaffoldProps<T>) {
  const { t } = useTranslation();
  const colors = useEventListColors();
  const bottomInset = useScrollBottomInset();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  type Row = { kind: 'header'; title: string; key: string } | { kind: 'row'; item: T; key: string };
  const data = useMemo<Row[]>(() => {
    if (isLoading || isError) return [];
    const out: Row[] = [];
    for (const s of sections) {
      out.push({ kind: 'header', title: t(s.titleKey), key: `h-${s.titleKey}` });
      for (const item of s.items) out.push({ kind: 'row', item, key: `r-${item.id}` });
    }
    return out;
  }, [isLoading, isError, sections, t]);

  let emptyComponent: React.ReactNode;
  if (isLoading) {
    emptyComponent = (
      <View style={styles.skeletonList}>
        {[1, 2, 3, 4, 5].map(i => (
          <EventCardSkeleton key={i} bannerAspect={skeletonBannerAspect} />
        ))}
      </View>
    );
  } else if (isError) {
    emptyComponent = (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
        <Text size="base" weight="semibold" color={colors.text} style={styles.centeredText}>
          {t(loadErrorKey)}
        </Text>
        <Button
          variant="primary"
          size="md"
          onPress={() => void refetch()}
          style={styles.retryButton}
        >
          {t(retryKey)}
        </Button>
      </View>
    );
  } else {
    emptyComponent = (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon={<Ionicons name={emptyIcon} size={64} color={colors.primary} />}
          title={t(emptyTitleKey)}
          description={t(emptyDescriptionKey)}
        />
      </View>
    );
  }

  // One list in every state, with the header inside it: pull-to-refresh stays
  // live while loading, erroring and empty, not just once rows exist.
  // Bottom inset goes in the list's contentContainerStyle, not on the wrapper,
  // so the list scrolls under the home indicator instead of stopping above it.
  return (
    <SafeAreaView edges={[]} style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        data={data}
        keyExtractor={row => row.key}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: bottomInset },
          data.length === 0 && !isLoading && styles.emptyListContent,
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header ? <>{header}</> : null}
        ListEmptyComponent={emptyComponent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            return (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <Text size="sm" weight="semibold" color={colors.textMuted}>
                  {row.title}
                </Text>
              </View>
            );
          }
          return <>{renderCard(row.item)}</>;
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  centeredText: { marginTop: spacingPixels[3], textAlign: 'center' },
  retryButton: {
    marginTop: spacingPixels[4],
  },
  listContent: {
    paddingTop: spacingPixels[2],
    // Lets the empty/error state fill the screen so it centres and the whole
    // surface stays pullable.
    flexGrow: 1,
  },
  emptyListContent: {
    // Centring lives on the empty component, not here, so the list header stays
    // anchored to the top instead of floating down with the empty state.
    minHeight: '100%',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  sectionHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  skeletonList: {
    paddingTop: spacingPixels[2],
  },
});
