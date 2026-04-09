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
        match_count: f.upcoming_match_count ?? 0,
      },
    })),
  };
}

export function matchesToGeoJSON(
  matches: MapCustomMatch[],
  selectedIds: string[] | null
): GeoJSON.FeatureCollection {
  const selectedSet = selectedIds ? new Set(selectedIds) : null;
  return {
    type: 'FeatureCollection',
    features: matches.map(m => {
      const isPickleball = m.sport?.name?.toLowerCase() === 'pickleball';
      const isSelected = selectedSet?.has(m.id) ?? false;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [m.custom_longitude, m.custom_latitude],
        },
        properties: {
          id: m.id,
          icon: isPickleball
            ? isSelected
              ? 'marker-match-pickleball-selected'
              : 'marker-match-pickleball'
            : isSelected
              ? 'marker-match-tennis-selected'
              : 'marker-match-tennis',
        },
      };
    }),
  };
}
