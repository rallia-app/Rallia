import type { MapFacility, MapCustomMatch } from '@rallia/shared-hooks';

export function facilitiesToGeoJSON(
  facilities: MapFacility[],
  selectedId: string | null
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: facilities.map(f => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [f.longitude, f.latitude],
      },
      properties: {
        id: f.id,
        icon: f.id === selectedId ? 'marker-facility-selected' : 'marker-facility',
      },
    })),
  };
}

export function matchesToGeoJSON(matches: MapCustomMatch[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: matches.map(m => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [m.custom_longitude, m.custom_latitude],
      },
      properties: {
        id: m.id,
        icon:
          m.sport?.name?.toLowerCase() === 'pickleball'
            ? 'marker-match-pickleball'
            : 'marker-match-tennis',
      },
    })),
  };
}
