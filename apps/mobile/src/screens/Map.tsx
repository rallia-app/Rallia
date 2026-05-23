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
  FadeInDown,
  FadeOutDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { Ionicons } from '@expo/vector-icons';
import { Text, MatchCard } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, accent, neutral } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useMapData,
  useFavoriteFacilities,
  usePlayer,
  MIN_FAVORITE_FACILITIES,
} from '@rallia/shared-hooks';
import { useToast } from '@rallia/shared-components';
import type { MapFacility, MapCustomMatch, FormattedSlot, CourtOption } from '@rallia/shared-hooks';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MapStackParamList } from '../navigation/types';
import { SheetManager } from 'react-native-actions-sheet';
import {
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useOpenExternalBooking,
} from '../hooks';
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
  const { t, locale } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<MapStackParamList>>();
  const route = useRoute<RouteProp<MapStackParamList, 'MapView'>>();
  const { selectedSport } = useSport();
  const { location } = useEffectiveLocation();
  const { openSheet } = useMatchDetailSheet();
  const { player } = usePlayer();
  const toast = useToast();
  const { isFavorite, addFavorite, removeFavorite, isMaxReached, canRemoveFavorite } =
    useFavoriteFacilities(player?.id ?? null, selectedSport?.id);
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const facilitySourceRef = useRef<Mapbox.ShapeSource>(null);
  const matchSourceRef = useRef<Mapbox.ShapeSource>(null);
  const currentZoomRef = useRef(12);
  const currentCenterRef = useRef<[number, number] | null>(null);

  const [selectedFacilities, setSelectedFacilities] = useState<MapFacility[]>([]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  // Decouple the icon highlight from selectedFacilities so the GeoJSON doesn't
  // rebuild mid-camera-animation (which causes cluster flicker).
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const carouselRef = useRef<FlatList<MapFacility>>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [selectedMatches, setSelectedMatches] = useState<MapCustomMatch[]>([]);
  const [activeMatchCardIndex, setActiveMatchCardIndex] = useState(0);
  const matchCarouselRef = useRef<FlatList<MapCustomMatch>>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const shapePressed = useRef(false);

  const focusLocation = route.params?.focusLocation;
  const initialCenter: [number, number] = focusLocation
    ? [focusLocation.lng, focusLocation.lat]
    : location
      ? [location.longitude, location.latitude]
      : [-73.5673, 45.5017]; // Default: Montreal
  const initialZoom = focusLocation?.zoom ?? (focusLocation ? 13 : 10);

  // Fix for Android: Mapbox Camera defaultSettings may not apply reliably,
  // causing the map to start at the wrong location/zoom. Imperatively set
  // the camera once location is available to guarantee the correct position.
  const hasSetInitialCamera = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (hasSetInitialCamera.current) return;
    const center: [number, number] | null = focusLocation
      ? [focusLocation.lng, focusLocation.lat]
      : location
        ? [location.longitude, location.latitude]
        : null;
    if (!center) return;
    hasSetInitialCamera.current = true;
    const timer = setTimeout(() => {
      cameraRef.current?.setCamera({
        centerCoordinate: center,
        zoomLevel: initialZoom,
        animationDuration: 0,
      });
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, focusLocation]);

  const sportIds = selectedSport?.id ? [selectedSport.id] : undefined;

  const { facilities, customMatches, isLoading, refetch } = useMapData({
    sportIds,
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: 25,
    userGender: player?.gender,
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

  const refreshSpin = useSharedValue(0);
  const showRefreshSpin = isLoading || isRefreshing;
  useEffect(() => {
    if (showRefreshSpin) {
      refreshSpin.value = 0;
      refreshSpin.value = withRepeat(
        withTiming(360, { duration: 800, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      refreshSpin.value = withTiming(0, { duration: 200 });
    }
  }, [showRefreshSpin, refreshSpin]);
  const refreshAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${refreshSpin.value}deg` }],
  }));

  // Memoized GeoJSON for GL-native rendering
  // Uses highlightedId (delayed) instead of selectedFacility?.id to avoid
  // rebuilding the shape source mid-camera-animation which causes cluster flicker.
  const facilityGeoJson = useMemo(
    () => facilitiesToGeoJSON(facilities, highlightedId),
    [facilities, highlightedId]
  );
  const selectedMatchIds = useMemo(() => selectedMatches.map(m => m.id), [selectedMatches]);

  const matchGeoJson = useMemo(
    () => matchesToGeoJSON(customMatches, selectedMatchIds.length > 0 ? selectedMatchIds : null),
    [customMatches, selectedMatchIds]
  );

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
    if (state?.properties?.center) {
      currentCenterRef.current = state.properties.center;
    }
  }, []);

  const dismissCards = useCallback(() => {
    lightHaptic();
    clearTimeout(highlightTimer.current);
    setSelectedFacilities([]);
    setActiveCardIndex(0);
    setSelectedMatches([]);
    setActiveMatchCardIndex(0);
    setHighlightedId(null);
  }, []);

  const handleMapPress = useCallback(() => {
    // ShapeSource.onPress fires before MapView.onPress on the same tap —
    // skip dismissal when a marker was just pressed.
    if (shapePressed.current) {
      shapePressed.current = false;
      return;
    }
    dismissSearch();
    if (selectedFacilities.length > 0 || selectedMatches.length > 0) {
      dismissCards();
    }
  }, [selectedFacilities.length, selectedMatches.length, dismissSearch, dismissCards]);

  const handleFacilitySelect = useCallback((facilityOrFacilities: MapFacility | MapFacility[]) => {
    lightHaptic();
    const arr = Array.isArray(facilityOrFacilities) ? facilityOrFacilities : [facilityOrFacilities];
    setSelectedFacilities(arr);
    setActiveCardIndex(0);
    setSelectedMatches([]);
    setActiveMatchCardIndex(0);
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

  const handleMatchSelect = useCallback((matchOrMatches: MapCustomMatch | MapCustomMatch[]) => {
    lightHaptic();
    const arr = Array.isArray(matchOrMatches) ? matchOrMatches : [matchOrMatches];
    setSelectedMatches(arr);
    setActiveMatchCardIndex(0);
    setSelectedFacilities([]);
    setActiveCardIndex(0);
    clearTimeout(highlightTimer.current);
    setHighlightedId(null);
    const target = arr[0];
    if (cameraRef.current) {
      const offset = latOffsetForZoom(currentZoomRef.current);
      cameraRef.current.setCamera({
        centerCoordinate: [target.custom_longitude, target.custom_latitude - offset],
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
        const clusterMaxZoom = 24;
        try {
          const expansionZoom = await matchSourceRef.current?.getClusterExpansionZoom(feature);
          if (
            expansionZoom != null &&
            expansionZoom <= clusterMaxZoom &&
            expansionZoom > currentZoomRef.current
          ) {
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

        // Can't expand further — show match cards
        try {
          const pointCount = feature.properties.point_count ?? 2;
          const leaves = await matchSourceRef.current?.getClusterLeaves(feature, pointCount, 0);
          if (leaves?.features?.length) {
            const matchIds = leaves.features.map((f: any) => f.properties?.id).filter(Boolean);
            const matches = customMatches.filter(m => matchIds.includes(m.id));
            if (matches.length > 0) {
              handleMatchSelect(matches);
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
        handleMatchSelect(match);
      }
    },
    [customMatches, handleMatchSelect]
  );

  const handleTooltipPress = useCallback(
    (facilityId: string) => {
      navigation.navigate('FacilityDetail', { facilityId });
    },
    [navigation]
  );

  const handleMatchCardPress = useCallback(
    (match: MapCustomMatch) => {
      openSheet(match as unknown as MatchDetailData);
    },
    [openSheet]
  );

  const { openExternalBooking } = useOpenExternalBooking();

  const handleSlotPress = useCallback(
    (facility: unknown, slot: FormattedSlot) => {
      const f = facility as {
        id: string;
        name: string;
        address?: string | null;
        city?: string | null;
        timezone?: string | null;
      };

      if (slot.courtOptions.length > 1) {
        SheetManager.show('court-selection', {
          payload: {
            courts: slot.courtOptions ?? [],
            timeLabel: slot.time ?? '',
            onSelect: (court: unknown) => {
              const c = court as CourtOption;
              openExternalBooking({
                facility: f,
                slot,
                selectedCourt: c,
                source: 'map',
                sportId: selectedSport?.id,
                sportName: selectedSport?.name,
              });
            },
            onCancel: () => {},
          },
        });
        return;
      }

      openExternalBooking({
        facility: f,
        slot,
        source: 'map',
        sportId: selectedSport?.id,
        sportName: selectedSport?.name,
      });
    },
    [openExternalBooking, selectedSport?.id, selectedSport?.name]
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

  const onViewableMatchItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      const idx = viewableItems[0]?.index;
      if (idx != null) {
        setActiveMatchCardIndex(idx);
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
          clusterProperties={{
            total_matches: [
              ['+', ['accumulated'], ['get', 'total_matches']],
              ['get', 'match_count'],
            ],
          }}
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
          {/* Match count badge — top-right of cluster bubble */}
          <Mapbox.SymbolLayer
            id="facility-cluster-badge"
            filter={['all', ['has', 'point_count'], ['>', ['get', 'total_matches'], 0]]}
            style={{
              iconImage: 'badge-match-count',
              iconSize: 1,
              iconAnchor: 'center',
              iconTranslate: [18, -18],
              iconAllowOverlap: true,
              textField: ['to-string', ['get', 'total_matches']],
              textSize: 11,
              textColor: '#ffffff',
              textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              textAnchor: 'center',
              textTranslate: [18, -18],
              textAllowOverlap: true,
            }}
          />
          {/* Match count badge — top-right of facility marker */}
          <Mapbox.SymbolLayer
            id="facility-badge"
            filter={['all', ['!', ['has', 'point_count']], ['>', ['get', 'match_count'], 0]]}
            style={{
              iconImage: 'badge-match-count',
              iconSize: 1,
              iconAnchor: 'center',
              iconTranslate: [15, -48],
              iconAllowOverlap: true,
              textField: ['to-string', ['get', 'match_count']],
              textSize: 11,
              textColor: '#ffffff',
              textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
              textAnchor: 'center',
              textTranslate: [15, -48],
              textAllowOverlap: true,
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
          clusterMaxZoomLevel={24}
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

        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: colors.card }]}
          onPress={() => {
            lightHaptic();
            setIsRefreshing(true);
            refetch();
            setTimeout(() => setIsRefreshing(false), 1000);
          }}
          activeOpacity={0.7}
          accessible
          accessibilityLabel="Refresh"
        >
          <Animated.View style={refreshAnimatedStyle}>
            <Ionicons name="refresh-outline" size={22} color={colors.text} />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* Map Legend */}
      {/* Facility card carousel */}
      {selectedFacilities.length === 1 && (
        <Animated.View
          entering={FadeInDown.duration(250)}
          exiting={FadeOutDown.duration(150)}
          style={[styles.facilityCardWrapper, { bottom: insets.bottom + 24 }]}
        >
          <TouchableOpacity onPress={dismissCards} style={styles.dismissButton} activeOpacity={0.7}>
            <View style={[styles.dismissCircle, { backgroundColor: colors.card }]}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <FacilityCard
            facility={selectedFacilities[0]}
            isFavorite={isFavorite(selectedFacilities[0].id)}
            onPress={() => handleTooltipPress(selectedFacilities[0].id)}
            onToggleFavorite={f => {
              lightHaptic();
              if (isFavorite(f.id)) {
                if (!canRemoveFavorite) {
                  toast.info(
                    t('facilitiesTab.favorites.minimumRequired', {
                      min: MIN_FAVORITE_FACILITIES,
                    })
                  );
                  return;
                }
                removeFavorite(f.id);
              } else if (!isMaxReached) {
                addFavorite(f);
              }
            }}
            isMaxFavoritesReached={isMaxReached}
            showFavoriteButton={!!player?.id}
            sportName={selectedSport?.name}
            onSlotPress={handleSlotPress}
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
          style={[styles.facilityCardWrapper, { bottom: insets.bottom + 24 }]}
        >
          <TouchableOpacity onPress={dismissCards} style={styles.dismissButton} activeOpacity={0.7}>
            <View style={[styles.dismissCircle, { backgroundColor: colors.card }]}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
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
                      if (!canRemoveFavorite) {
                        toast.info(
                          t('facilitiesTab.favorites.minimumRequired', {
                            min: MIN_FAVORITE_FACILITIES,
                          })
                        );
                        return;
                      }
                      removeFavorite(f.id);
                    } else if (!isMaxReached) {
                      addFavorite(f);
                    }
                  }}
                  isMaxFavoritesReached={isMaxReached}
                  showFavoriteButton={!!player?.id}
                  sportName={selectedSport?.name}
                  onSlotPress={handleSlotPress}
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

      {/* Match card carousel */}
      {selectedMatches.length === 1 && (
        <Animated.View
          entering={FadeInDown.duration(250)}
          exiting={FadeOutDown.duration(150)}
          style={[styles.facilityCardWrapper, { bottom: insets.bottom + 24 }]}
        >
          <TouchableOpacity onPress={dismissCards} style={styles.dismissButton} activeOpacity={0.7}>
            <View style={[styles.dismissCircle, { backgroundColor: colors.card }]}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <View style={{ paddingHorizontal: spacingPixels[4] }}>
            <MatchCard
              match={selectedMatches[0]}
              onPress={() => handleMatchCardPress(selectedMatches[0])}
              isDark={isDark}
              t={t}
              locale={locale}
              currentPlayerId={player?.id}
              sportIcon={
                <SportIcon
                  sportName={selectedMatches[0].sport?.name ?? 'tennis'}
                  size={100}
                  color={isDark ? neutral[600] : neutral[400]}
                />
              }
            />
          </View>
        </Animated.View>
      )}
      {selectedMatches.length > 1 && (
        <Animated.View
          entering={FadeInDown.duration(250)}
          exiting={FadeOutDown.duration(150)}
          style={[styles.facilityCardWrapper, { bottom: insets.bottom + 24 }]}
        >
          <TouchableOpacity onPress={dismissCards} style={styles.dismissButton} activeOpacity={0.7}>
            <View style={[styles.dismissCircle, { backgroundColor: colors.card }]}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
          <FlatList
            ref={matchCarouselRef}
            data={selectedMatches}
            keyExtractor={item => item.id}
            horizontal
            snapToInterval={SNAP_INTERVAL}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: CARD_OVERLAP }}
            onViewableItemsChanged={onViewableMatchItemsChanged}
            viewabilityConfig={viewabilityConfig}
            getItemLayout={getItemLayout}
            renderItem={({ item }) => (
              <View style={{ width: CARD_WIDTH, marginRight: -CARD_OVERLAP }}>
                <MatchCard
                  match={item}
                  onPress={() => handleMatchCardPress(item)}
                  isDark={isDark}
                  t={t}
                  locale={locale}
                  currentPlayerId={player?.id}
                  sportIcon={
                    <SportIcon
                      sportName={item.sport?.name ?? 'tennis'}
                      size={100}
                      color={isDark ? neutral[600] : neutral[400]}
                    />
                  }
                />
              </View>
            )}
          />
          <View style={styles.dotsRow}>
            {selectedMatches.map((m, i) => (
              <View
                key={m.id}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      i === activeMatchCardIndex ? colors.primary : colors.textMuted + '40',
                  },
                ]}
              />
            ))}
          </View>
        </Animated.View>
      )}
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

  // Card dismiss button
  dismissButton: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  dismissCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  // Facility / match card
  facilityCardWrapper: {
    position: 'absolute',
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
});

export default Map;
