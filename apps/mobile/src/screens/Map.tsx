import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import { useMapData, useFavoriteFacilities, usePlayer } from '@rallia/shared-hooks';
import type { MapFacility, MapCustomMatch } from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation, useEffectiveLocation } from '../hooks';
import { useAppNavigation, useRootRoute } from '../navigation/hooks';
import { useSport, useMatchDetailSheet } from '../context';
import type { MatchDetailData } from '../context/MatchDetailSheetContext';
import { MapMarkerImages } from '../components/map/MapMarkerImages';
import { facilitiesToGeoJSON, matchesToGeoJSON } from '../components/map/mapGeoJson';
import { FacilityCard } from '../features/facilities/components';

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

const Map = () => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const navigation = useAppNavigation();
  const route = useRootRoute<'Map'>();
  const { selectedSport } = useSport();
  const { location } = useEffectiveLocation();
  const { openSheet } = useMatchDetailSheet();
  const { player } = usePlayer();
  const { isFavorite, addFavorite, removeFavorite, isMaxReached } = useFavoriteFacilities(
    player?.id ?? null
  );
  const cameraRef = useRef<Mapbox.Camera>(null);
  const facilitySourceRef = useRef<Mapbox.ShapeSource>(null);
  const matchSourceRef = useRef<Mapbox.ShapeSource>(null);

  const [selectedFacility, setSelectedFacility] = useState<MapFacility | null>(null);
  const shapePressed = useRef(false);

  const focusLocation = route.params?.focusLocation;
  const initialCenter: [number, number] = focusLocation
    ? [focusLocation.lng, focusLocation.lat]
    : location
      ? [location.longitude, location.latitude]
      : [-73.5673, 45.5017]; // Default: Montreal
  const initialZoom = focusLocation ? 15 : 12;

  const sportIds = selectedSport?.id ? [selectedSport.id] : undefined;

  const { facilities, customMatches, isLoading } = useMapData({
    sportIds,
    latitude: location?.latitude,
    longitude: location?.longitude,
    maxDistanceKm: 25,
    enabled: !!location,
  });

  // Memoized GeoJSON for GL-native rendering
  const facilityGeoJson = useMemo(
    () => facilitiesToGeoJSON(facilities, selectedFacility?.id ?? null),
    [facilities, selectedFacility?.id]
  );
  const matchGeoJson = useMemo(() => matchesToGeoJSON(customMatches), [customMatches]);

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

  const handleMapPress = useCallback(() => {
    // ShapeSource.onPress fires before MapView.onPress on the same tap —
    // skip dismissal when a marker was just pressed.
    if (shapePressed.current) {
      shapePressed.current = false;
      return;
    }
    if (selectedFacility) {
      lightHaptic();
      setSelectedFacility(null);
    }
  }, [selectedFacility]);

  const handleFacilitySelect = useCallback((facility: MapFacility) => {
    lightHaptic();
    setSelectedFacility(facility);
    if (cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [facility.longitude, facility.latitude],
        animationDuration: 300,
        padding: { paddingBottom: 280, paddingTop: 0, paddingLeft: 0, paddingRight: 0 },
      });
    }
  }, []);

  const handleFacilityShapePress = useCallback(
    async (event: any) => {
      shapePressed.current = true;
      const features = event?.features;
      if (!features?.length) return;
      const tapCoord = event?.coordinates;
      const feature = pickClosestFeature(features, tapCoord);

      // Cluster tap → zoom in
      if (feature?.properties?.cluster) {
        const zoom = await facilitySourceRef.current?.getClusterExpansionZoom(feature);
        if (zoom != null) {
          cameraRef.current?.setCamera({
            centerCoordinate: feature.geometry.coordinates,
            zoomLevel: zoom,
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

      // Cluster tap → zoom in
      if (feature?.properties?.cluster) {
        const zoom = await matchSourceRef.current?.getClusterExpansionZoom(feature);
        if (zoom != null) {
          cameraRef.current?.setCamera({
            centerCoordinate: feature.geometry.coordinates,
            zoomLevel: zoom,
            animationDuration: 500,
          });
        }
        return;
      }

      if (!feature?.properties?.id) return;
      const match = customMatches.find(m => m.id === feature.properties.id);
      if (match) {
        lightHaptic();
        setSelectedFacility(null);
        openSheet(match as unknown as MatchDetailData);
      }
    },
    [customMatches, openSheet]
  );

  const handleTooltipPress = useCallback(
    (facilityId: string) => {
      navigation.navigate('Main', {
        screen: 'Courts',
        params: {
          screen: 'FacilityDetail',
          params: { facilityId },
        },
      });
    },
    [navigation, selectedSport?.id]
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
        <View style={styles.closeButtonContainer}>
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: colors.card }]}
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
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled
        compassPosition={{ top: 60, right: 16 }}
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
          clusterMaxZoomLevel={14}
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

      {/* Loading indicator */}
      {isLoading && (
        <View style={[styles.loadingPill, { backgroundColor: colors.card }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text size="xs" color={colors.textMuted}>
            {t('map.loading')}
          </Text>
        </View>
      )}

      {/* Facility card */}
      {selectedFacility && (
        <Animated.View
          entering={FadeInDown.duration(250)}
          exiting={FadeOutDown.duration(150)}
          style={styles.facilityCardWrapper}
        >
          <FacilityCard
            facility={selectedFacility}
            isFavorite={isFavorite(selectedFacility.id)}
            onPress={() => handleTooltipPress(selectedFacility.id)}
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

      {/* Re-center button */}
      <View style={styles.recenterContainer}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.card }]}
          onPress={handleRecenter}
          activeOpacity={0.7}
          accessible
          accessibilityLabel={t('map.recenter')}
        >
          <Ionicons name="locate-outline" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Close button */}
      <View style={styles.closeButtonContainer}>
        <TouchableOpacity
          style={[styles.closeButton, { backgroundColor: colors.card }]}
          onPress={handleClose}
          activeOpacity={0.7}
        >
          <Ionicons name="close-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>
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
  facilityCardWrapper: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    zIndex: 20,
  },
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
  recenterContainer: {
    position: 'absolute',
    bottom: spacingPixels[8],
    right: spacingPixels[4],
    zIndex: 10,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  closeButtonContainer: {
    position: 'absolute',
    bottom: spacingPixels[8],
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});

export default Map;
