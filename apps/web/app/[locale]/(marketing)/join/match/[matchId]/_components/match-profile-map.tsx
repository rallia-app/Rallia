'use client';

type MatchProfileMapProps = {
  latitude: number;
  longitude: number;
};

/** Static OpenStreetMap embed — avoids SSR issues with react-leaflet. */
export function MatchProfileMap({ latitude, longitude }: MatchProfileMapProps) {
  const delta = 0.008;
  const bbox = [
    longitude - delta,
    latitude - delta * 0.75,
    longitude + delta,
    latitude + delta * 0.75,
  ].join('%2C');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}`;

  return (
    <iframe
      title="Match location map"
      src={src}
      className="h-44 w-full rounded-lg border-0"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
