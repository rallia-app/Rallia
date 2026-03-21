import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Dimensions,
  Keyboard,
  Platform,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOutDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, accent } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useMapData, useFavoriteFacilities, usePlayer } from '@rallia/shared-hooks';
import type { MapFacility, MapCustomMatch } from '@rallia/shared-hooks';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MapStackParamList } from '../navigation/types';
import { useThemeStyles, useTranslation, useEffectiveLocation } from '../hooks';
import { useSport, useMatchDetailSheet } from '../context';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import { SearchBar } from '../components/SearchBar';
import { MapMarkerImages } from '../components/map/MapMarkerImages';
import { facilitiesToGeoJSON, matchesToGeoJSON } from '../components/map/mapGeoJson';
import { FacilityCard } from '../features/facilities/components';
import { SportIcon } from '../components/SportIcon';

/** Pick the feature whose coordinate is closest to the tap point. */
function pickClosestFeature(features: any[], tapCoord?: { latitude: number; longitude: number }) {
  if (features.length === 1 || !tapCoord) return features[0];
  let best = features[0];
  let bestDist = Infinity;
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const dx = coords[0] - tapCoord.longitude;
    const dy = coords[1] - tapCoord.latitude;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }
  return best;
}

/** Calculate latitude offset so the marker sits visually above the card area. */
function latOffsetForZoom(zoom: number): number {
  // At zoom 12 we need ~0.012° offset, halving for each zoom level increase
  return 0.012 / Math.pow(2, zoom - 12);
}

const Map = () => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<MapStackParamList>>();
  const route = useRoute<RouteProp<MapStackParamList, 'MapView'>>();
  const { selectedSport } = useSport();
  const { location } = useEffectiveLocation();
  const { openSheet } = useMatchDetailSheet();
  const { player } = usePlayer();
  const { isFavorite, addFavorite, removeFavorite, isMaxReached } = useFavoriteFacilities(
    player?.id ?? null
  );
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const facilitySourceRef = useRef<Mapbox.ShapeSource>(null);
  const matchSourceRef = useRef<Mapbox.ShapeSource>(null);
  const currentZoomRef = useRef(12);
  const matchListSheetRef = useRef<BottomSheetModal>(null);

  const [selectedFacilities, setSelectedFacilities] = useState<MapFacility[]>([]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  // Decouple the icon highlight from selectedFacilities so the GeoJSON doesn't
  // rebuild mid-camera-animation (which causes cluster flicker).
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const carouselRef = useRef<FlatList<MapFacility>>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [clusterMatches, setClusterMatches] = useState<MapCustomMatch[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const shapePressed = useRef(false);

  const focusLocation = route.params?.focusLocation;
  const initialCenter: [number, number] = focusLocation
    ? [focusLocation.lng, focusLocation.lat]
    : location
      ? [location.longitude, location.latitude]
      : [-73.5673, 45.5017]; // Default: Montreal
  const initialZoom = focusLocation ? 13 : 10;

  // Fix for Android: Mapbox Camera defaultSettings may not apply reliably,
  // causing the map to start at the wrong location/zoom. Imperatively set
  // the camera once after mount to guarantee the correct initial position.
  useEffect(() => {
    if (Platform.OS === 'android' && cameraRef.current) {
      const timer = setTimeout(() => {
        cameraRef.current?.setCamera({
          centerCoordinate: initialCenter,
          zoomLevel: initialZoom,
          animationDuration: 0,
        });
      }, 150);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sportIds = selectedSport?.id ? [selectedSport.id] : undefined;

  const { facilities, customMatches, isLoading } = useMapData({
    sportIds,
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: 25,
    enabled: !!location,
  });

  // --- Loading pill pulsing animation ---
  const loadingOpacity = useSharedValue(1);

  useEffect(() => {
    if (isLoading) {
      loadingOpacity.value = withRepeat(
        withSequence(withTiming(0.6, { duration: 500 }), withTiming(1, { duration: 500 })),
        -1,
        false
      );
    } else {
      loadingOpacity.value = 1;
    }
  }, [isLoading, loadingOpacity]);

  const loadingAnimatedStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
  }));

  // Memoized GeoJSON for GL-native rendering
  // Uses highlightedId (delayed) instead of selectedFacility?.id to avoid
  // rebuilding the shape source mid-camera-animation which causes cluster flicker.
  const facilityGeoJson = useMemo(
    () => facilitiesToGeoJSON(facilities, highlightedId),
    [facilities, highlightedId]
  );
  const matchGeoJson = useMemo(() => matchesToGeoJSON(customMatches), [customMatches]);

  const filteredFacilities = useMemo(() => {
    const normalized = searchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized) return [];
    const terms = normalized.split(' ');
    return facilities
      .filter(f => {
        const haystack = [f.name, f.address, f.city].filter(Boolean).join(' ').toLowerCase();
        return terms.every(term => haystack.includes(term));
      })
      .slice(0, 5);
  }, [searchQuery, facilities]);

  const showSearchResults =
    isSearchFocused && searchQuery.trim().length > 0 && filteredFacilities.length > 0;

  const dismissSearch = useCallback(() => {
    if (isSearchFocused || searchQuery.length > 0) {
      setSearchQuery('');
      setIsSearchFocused(false);
      Keyboard.dismiss();
    }
  }, [isSearchFocused, searchQuery]);

  const handleClose = useCallback(() => {
    lightHaptic();
    navigation.goBack();
  }, [navigation]);

  const handleRecenter = useCallback(() => {
    lightHaptic();
    if (location && cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [location.longitude, location.latitude],
        zoomLevel: 12,
        animationDuration: 500,
      });
    }
  }, [location]);

  const handleZoomIn = useCallback(() => {
    lightHaptic();
    if (cameraRef.current) {
      cameraRef.current.setCamera({
        zoomLevel: currentZoomRef.current + 1,
        animationDuration: 300,
      });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    lightHaptic();
    if (cameraRef.current) {
      cameraRef.current.setCamera({
        zoomLevel: currentZoomRef.current - 1,
        animationDuration: 300,
      });
    }
  }, []);

  const handleCameraChanged = useCallback((state: any) => {
    if (state?.properties?.zoom != null) {
      currentZoomRef.current = state.properties.zoom;
    }
  }, []);

  const handleMapPress = useCallback(() => {
    // ShapeSource.onPress fires before MapView.onPress on the same tap —
    // skip dismissal when a marker was just pressed.
    if (shapePressed.current) {
      shapePressed.current = false;
      return;
    }
    dismissSearch();
    if (selectedFacilities.length > 0) {
      lightHaptic();
      clearTimeout(highlightTimer.current);
      setSelectedFacilities([]);
      setActiveCardIndex(0);
      setHighlightedId(null);
    }
  }, [selectedFacilities.length, dismissSearch]);

  const handleFacilitySelect = useCallback((facilityOrFacilities: MapFacility | MapFacility[]) => {
    lightHaptic();
    const arr = Array.isArray(facilityOrFacilities) ? facilityOrFacilities : [facilityOrFacilities];
    setSelectedFacilities(arr);
    setActiveCardIndex(0);
    // Delay the icon highlight until after the camera animation finishes
    // so the GeoJSON doesn't rebuild mid-flight and cause cluster flicker.
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(arr[0].id), 350);
    const target = arr[0];
    if (cameraRef.current) {
      const offset = latOffsetForZoom(currentZoomRef.current);
      cameraRef.current.setCamera({
        centerCoordinate: [target.longitude, target.latitude - offset],
        animationDuration: 300,
      });
    }
  }, []);

  const handleSearchResultPress = useCallback(
    (facility: MapFacility) => {
      setSearchQuery('');
      setIsSearchFocused(false);
      Keyboard.dismiss();
      handleFacilitySelect(facility);
    },
    [handleFacilitySelect]
  );

  const handleFacilityShapePress = useCallback(
    async (event: any) => {
      shapePressed.current = true;
      const features = event?.features;
      if (!features?.length) return;
      const tapCoord = event?.coordinates;
      const feature = pickClosestFeature(features, tapCoord);

      // Cluster tap → zoom in or show carousel if can't expand further
      if (feature?.properties?.cluster) {
        const clusterMaxZoom = 24;
        const expansionZoom = await facilitySourceRef.current?.getClusterExpansionZoom(feature);

        // If expansion zoom exceeds max or is at/below current zoom, the cluster
        // contains same-address facilities — show them all in a carousel.
        if (
          expansionZoom == null ||
          expansionZoom > clusterMaxZoom ||
          expansionZoom <= currentZoomRef.current
        ) {
          try {
            const pointCount = feature.properties.point_count ?? 2;
            const leaves = await facilitySourceRef.current?.getClusterLeaves(
              feature,
              pointCount,
              0
            );
            if (leaves?.features?.length) {
              const leafIds = leaves.features.map((f: any) => f.properties?.id).filter(Boolean);
              const matched = facilities.filter(f => leafIds.includes(f.id));
              if (matched.length > 0) {
                handleFacilitySelect(matched);
                // Center on cluster coordinate
                const offset = latOffsetForZoom(currentZoomRef.current);
                const coords = feature.geometry.coordinates;
                cameraRef.current?.setCamera({
                  centerCoordinate: [coords[0], coords[1] - offset],
                  animationDuration: 300,
                });
                return;
              }
            }
          } catch {
            // Fall through to normal zoom
          }
        }

        if (expansionZoom != null) {
          cameraRef.current?.setCamera({
            centerCoordinate: feature.geometry.coordinates,
            zoomLevel: expansionZoom + 1,
            animationDuration: 500,
          });
        }
        return;
      }

      if (!feature?.properties?.id) return;
      const facility = facilities.find(f => f.id === feature.properties.id);
      if (facility) handleFacilitySelect(facility);
    },
    [facilities, handleFacilitySelect]
  );

  const handleMatchShapePress = useCallback(
    async (event: any) => {
      shapePressed.current = true;
      const features = event?.features;
      if (!features?.length) return;
      const tapCoord = event?.coordinates;
      const feature = pickClosestFeature(features, tapCoord);

      // Cluster tap → zoom in or show list if can't expand further
      if (feature?.properties?.cluster) {
        try {
          const expansionZoom = await matchSourceRef.current?.getClusterExpansionZoom(feature);
          if (expansionZoom != null && expansionZoom > currentZoomRef.current) {
            cameraRef.current?.setCamera({
              centerCoordinate: feature.geometry.coordinates,
              zoomLevel: expansionZoom + 1,
              animationDuration: 500,
            });
            return;
          }
        } catch {
          // getClusterExpansionZoom can fail for fully-stacked points — fall through to list
        }

        // Can't expand further — show match list sheet
        try {
          const pointCount = feature.properties.point_count ?? 2;
          const leaves = await matchSourceRef.current?.getClusterLeaves(feature, pointCount, 0);
          if (leaves?.features?.length) {
            const matchIds = leaves.features.map((f: any) => f.properties?.id).filter(Boolean);
            const matches = customMatches.filter(m => matchIds.includes(m.id));
            if (matches.length > 0) {
              lightHaptic();
              setClusterMatches(matches);
              matchListSheetRef.current?.present();
            }
          }
        } catch {
          // Fallback: just zoom in
          cameraRef.current?.setCamera({
            centerCoordinate: feature.geometry.coordinates,
            zoomLevel: currentZoomRef.current + 2,
            animationDuration: 500,
          });
        }
        return;
      }

      if (!feature?.properties?.id) return;
      const match = customMatches.find(m => m.id === feature.properties.id);
      if (match) {
        lightHaptic();
        clearTimeout(highlightTimer.current);
        setSelectedFacilities([]);
        setActiveCardIndex(0);
        setHighlightedId(null);
        openSheet(match as unknown as MatchDetailData);
      }
    },
    [customMatches, openSheet]
  );

  const handleMatchListItemPress = useCallback(
    (match: MapCustomMatch) => {
      matchListSheetRef.current?.dismiss();
      setClusterMatches([]);
      openSheet(match as unknown as MatchDetailData);
    },
    [openSheet]
  );

  const handleTooltipPress = useCallback(
    (facilityId: string) => {
      navigation.navigate('FacilityDetail', { facilityId });
    },
    [navigation]
  );

  const PEEK = 24;
  const CARD_OVERLAP = 20; // Eat into the card's own 16+16px gap between items
  const SCREEN_WIDTH = Dimensions.get('window').width;
  const CARD_WIDTH = SCREEN_WIDTH - PEEK;
  const SNAP_INTERVAL = CARD_WIDTH - CARD_OVERLAP;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      const idx = viewableItems[0]?.index;
      if (idx != null) {
        setActiveCardIndex(idx);
      }
    },
    []
  );

  // Sync highlightedId when activeCardIndex changes (from swiping)
  useEffect(() => {
    if (selectedFacilities.length > 0 && selectedFacilities[activeCardIndex]) {
      clearTimeout(highlightTimer.current);
      setHighlightedId(selectedFacilities[activeCardIndex].id);
    }
  }, [activeCardIndex, selectedFacilities]);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: SNAP_INTERVAL,
      offset: SNAP_INTERVAL * index,
      index,
    }),
    [SNAP_INTERVAL]
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.4} />
    ),
    []
  );

  const matchListSnapPoints = useMemo(() => ['35%', '60%'], []);

  const primaryDot = isDark ? primary[400] : primary[500];
  const accentDot = isDark ? accent[400] : accent[500];
  const showLegend = facilities.length > 0 && customMatches.length > 0;

  // No location available
  if (!location) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.noLocationContainer}>
          <Ionicons name="location-outline" size={48} color={colors.textMuted} />
          <Text size="base" color={colors.textMuted} style={styles.noLocationText}>
            {t('map.noLocation')}
          </Text>
        </View>
        <View style={[styles.controlStack, { top: insets.top + 12, right: 16 }]}>
          <TouchableOpacity
            style={[styles.controlButton, { backgroundColor: colors.card }]}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <Ionicons name="close-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <Mapbox.MapView
        style={styles.map}
        styleURL={isDark ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        onPress={handleMapPress}
        onCameraChanged={handleCameraChanged}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter,
            zoomLevel: initialZoom,
          }}
        />

        <Mapbox.LocationPuck visible puckBearingEnabled puckBearing="heading" />

        {/* Rasterize marker images into the GL texture atlas */}
        <MapMarkerImages isDark={isDark} />

        {/* Facility markers — rendered natively in the GL canvas */}
        <Mapbox.ShapeSource
          ref={facilitySourceRef}
          id="facility-source"
          shape={facilityGeoJson}
          cluster={true}
          clusterRadius={50}
          clusterMaxZoomLevel={24}
          onPress={handleFacilityShapePress}
          hitbox={{ width: 44, height: 44 }}
        >
          {/* Cluster bubble background */}
          <Mapbox.SymbolLayer
            id="facility-clusters"
            filter={['has', 'point_count']}
            style={{
              iconImage: [
                'step',
                ['get', 'point_count'],
                'cluster-facility-sm',
                10,
                'cluster-facility-md',
                50,
                'cluster-facility-lg',
              ],
              iconSize: 1,
              iconAnchor: 'center',
              iconAllowOverlap: true,
              textField: ['get', 'point_count_abbreviated'],
              textSize: ['step', ['get', 'point_count'], 13, 10, 15, 50, 17],
              textColor: '#ffffff',
              textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              textAnchor: 'center',
              textTranslate: [-1, 0],
              textAllowOverlap: true,
            }}
          />
          <Mapbox.SymbolLayer
            id="facility-symbols"
            filter={['!', ['has', 'point_count']]}
            style={{
              iconImage: ['get', 'icon'],
              iconSize: 1,
              iconAllowOverlap: true,
              iconAnchor: 'bottom',
            }}
          />
        </Mapbox.ShapeSource>

        {/* Match markers — rendered natively in the GL canvas */}
        <Mapbox.ShapeSource
          ref={matchSourceRef}
          id="match-source"
          shape={matchGeoJson}
          cluster={true}
          clusterRadius={50}
          clusterMaxZoomLevel={14}
          hitbox={{ width: 44, height: 44 }}
          onPress={handleMatchShapePress}
        >
          {/* Cluster bubble background */}
          <Mapbox.SymbolLayer
            id="match-clusters"
            filter={['has', 'point_count']}
            style={{
              iconImage: [
                'step',
                ['get', 'point_count'],
                'cluster-match-sm',
                10,
                'cluster-match-md',
                50,
                'cluster-match-lg',
              ],
              iconSize: 1,
              iconAnchor: 'center',
              iconAllowOverlap: true,
              textField: ['get', 'point_count_abbreviated'],
              textSize: ['step', ['get', 'point_count'], 13, 10, 15, 50, 17],
              textColor: '#ffffff',
              textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              textAnchor: 'center',
              textTranslate: [-1, 0],
              textAllowOverlap: true,
            }}
          />
          <Mapbox.SymbolLayer
            id="match-symbols"
            filter={['!', ['has', 'point_count']]}
            style={{
              iconImage: ['get', 'icon'],
              iconSize: 1,
              iconAllowOverlap: true,
              iconAnchor: 'bottom',
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      {/* Loading indicator with pulsing animation */}
      {isLoading && (
        <Animated.View
          style={[
            styles.loadingPill,
            { backgroundColor: colors.card + 'E6' },
            loadingAnimatedStyle,
          ]}
        >
          <ActivityIndicator size="small" color={colors.primary} />
          <Text size="xs" color={colors.textMuted}>
            {t('map.loading')}
          </Text>
        </Animated.View>
      )}

      {/* Search bar */}
      <View style={[styles.searchWrapper, { top: insets.top + 12 }]}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('map.searchPlaceholder')}
          onFocus={() => setIsSearchFocused(true)}
          returnKeyType="search"
          containerStyle={{ backgroundColor: colors.card }}
        />
        {showSearchResults && (
          <Animated.View
            entering={FadeInDown.duration(150)}
            exiting={FadeOutDown.duration(100)}
            style={[styles.searchResults, { backgroundColor: colors.card }]}
          >
            {filteredFacilities.map((facility, index) => (
              <TouchableOpacity
                key={facility.id}
                style={[
                  styles.searchResultRow,
                  index < filteredFacilities.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
                onPress={() => handleSearchResultPress(facility)}
                activeOpacity={0.7}
              >
                <Ionicons name="location-outline" size={18} color={colors.textMuted} />
                <View style={styles.searchResultText}>
                  <Text size="sm" weight="medium" color={colors.text} numberOfLines={1}>
                    {facility.name}
                  </Text>
                  {(facility.address || facility.city) && (
                    <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                      {[facility.address, facility.city].filter(Boolean).join(', ')}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </Animated.View>
        )}
      </View>

      {/* Right-side control stack (Apple Maps style) */}
      <View style={[styles.controlStack, { top: insets.top + 12, right: 16 }]}>
        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: colors.card }]}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <Ionicons name="close-outline" size={24} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: colors.card }]}
          onPress={handleRecenter}
          activeOpacity={0.7}
          accessible
          accessibilityLabel={t('map.recenter')}
        >
          <Ionicons name="locate-outline" size={22} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: colors.card }]}
          onPress={handleZoomIn}
          activeOpacity={0.7}
          accessible
          accessibilityLabel={t('map.zoomIn')}
        >
          <Ionicons name="add-outline" size={22} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: colors.card }]}
          onPress={handleZoomOut}
          activeOpacity={0.7}
          accessible
          accessibilityLabel={t('map.zoomOut')}
        >
          <Ionicons name="remove-outline" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Map Legend */}
      {showLegend && (
        <Animated.View
          entering={FadeIn.delay(500)}
          style={[styles.legend, { backgroundColor: colors.card + 'E6' }]}
          pointerEvents="none"
        >
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: primaryDot }]} />
            <Text size="xs" color={colors.textMuted}>
              {t('map.legend.facilities')}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: accentDot }]} />
            <Text size="xs" color={colors.textMuted}>
              {t('map.legend.pickup')}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Facility card carousel */}
      {selectedFacilities.length === 1 && (
        <Animated.View
          entering={FadeInDown.duration(250)}
          exiting={FadeOutDown.duration(150)}
          style={styles.facilityCardWrapper}
        >
          <FacilityCard
            facility={selectedFacilities[0]}
            isFavorite={isFavorite(selectedFacilities[0].id)}
            onPress={() => handleTooltipPress(selectedFacilities[0].id)}
            onToggleFavorite={f => {
              lightHaptic();
              if (isFavorite(f.id)) {
                removeFavorite(f.id);
              } else if (!isMaxReached) {
                addFavorite(f);
              }
            }}
            isMaxFavoritesReached={isMaxReached}
            showFavoriteButton={!!player?.id}
            sportName={selectedSport?.name}
            isDark={isDark}
            colors={colors}
            t={t}
          />
        </Animated.View>
      )}
      {selectedFacilities.length > 1 && (
        <Animated.View
          entering={FadeInDown.duration(250)}
          exiting={FadeOutDown.duration(150)}
          style={styles.facilityCardWrapper}
        >
          <FlatList
            ref={carouselRef}
            data={selectedFacilities}
            keyExtractor={item => item.id}
            horizontal
            snapToInterval={SNAP_INTERVAL}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: CARD_OVERLAP }}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            getItemLayout={getItemLayout}
            renderItem={({ item }) => (
              <View style={{ width: CARD_WIDTH, marginRight: -CARD_OVERLAP }}>
                <FacilityCard
                  facility={item}
                  isFavorite={isFavorite(item.id)}
                  onPress={() => handleTooltipPress(item.id)}
                  onToggleFavorite={f => {
                    lightHaptic();
                    if (isFavorite(f.id)) {
                      removeFavorite(f.id);
                    } else if (!isMaxReached) {
                      addFavorite(f);
                    }
                  }}
                  isMaxFavoritesReached={isMaxReached}
                  showFavoriteButton={!!player?.id}
                  sportName={selectedSport?.name}
                  isDark={isDark}
                  colors={colors}
                  t={t}
                />
              </View>
            )}
          />
          <View style={styles.dotsRow}>
            {selectedFacilities.map((f, i) => (
              <View
                key={f.id}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i === activeCardIndex ? colors.primary : colors.textMuted + '40',
                  },
                ]}
              />
            ))}
          </View>
        </Animated.View>
      )}

      {/* Match list bottom sheet for stacked clusters */}
      <BottomSheetModal
        ref={matchListSheetRef}
        snapPoints={matchListSnapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        backgroundStyle={{ backgroundColor: colors.card }}
        handleIndicatorStyle={{ backgroundColor: colors.textMuted }}
        onDismiss={() => setClusterMatches([])}
      >
        <View style={styles.sheetHeader}>
          <Text size="base" weight="semibold" color={colors.text}>
            {t('map.matchesAtLocation')}
          </Text>
        </View>
        <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
          {clusterMatches.map(match => (
            <TouchableOpacity
              key={match.id}
              style={[styles.matchRow, { borderBottomColor: colors.border }]}
              onPress={() => handleMatchListItemPress(match)}
              activeOpacity={0.7}
            >
              <View style={[styles.matchRowIcon, { backgroundColor: accentDot + '20' }]}>
                <SportIcon sportName={match.sport?.name ?? 'tennis'} size={20} color={accentDot} />
              </View>
              <View style={styles.matchRowInfo}>
                <Text size="sm" weight="medium" color={colors.text} numberOfLines={1}>
                  {match.sport?.name ?? ''}
                  {match.location_name ? ` · ${match.location_name}` : ''}
                </Text>
                <Text size="xs" color={colors.textMuted} numberOfLines={1}>
                  {match.match_date
                    ? new Date(`${match.match_date}T${match.start_time}`).toLocaleDateString(
                        undefined,
                        {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        }
                      )
                    : ''}
                  {match.participants ? ` · ${match.participants.length} players` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </BottomSheetScrollView>
      </BottomSheetModal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  noLocationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[8],
  },
  noLocationText: {
    textAlign: 'center',
  },

  // Search bar
  searchWrapper: {
    position: 'absolute',
    left: 16,
    right: 72,
    zIndex: 25,
  },
  searchResults: {
    marginTop: 4,
    borderRadius: radiusPixels.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    overflow: 'hidden',
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
    gap: spacingPixels[2],
  },
  searchResultText: {
    flex: 1,
    gap: 1,
  },

  // Right-side control stack
  controlStack: {
    position: 'absolute',
    zIndex: 15,
    gap: 12,
  },
  controlButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },

  // Loading pill
  loadingPill: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 15,
  },

  // Facility card
  facilityCardWrapper: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  // Page indicator dots
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // Legend
  legend: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Match list sheet
  sheetHeader: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[3],
  },
  sheetContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[3],
  },
  matchRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchRowInfo: {
    flex: 1,
    gap: 2,
  },
});

export default Map;
