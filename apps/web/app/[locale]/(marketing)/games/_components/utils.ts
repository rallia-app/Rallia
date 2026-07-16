export function getRelativeDateLabel(
  dateStr: string,
  locale: string,
  tToday: string,
  tTomorrow: string
): string {
  const now = new Date();
  const matchDate = new Date(dateStr + 'T00:00:00');

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterTomorrow = new Date(todayStart);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  if (matchDate >= todayStart && matchDate < tomorrowStart) return tToday;
  if (matchDate >= tomorrowStart && matchDate < dayAfterTomorrow) return tTomorrow;

  const sixDaysOut = new Date(todayStart);
  sixDaysOut.setDate(sixDaysOut.getDate() + 7);
  if (matchDate < sixDaysOut) {
    return matchDate.toLocaleDateString(locale, { weekday: 'long' });
  }

  return matchDate.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

import type { PublicMatch } from './public-match-card';

/** Facility coordinates take priority, then the match's custom location. */
export function resolveMatchCoords(match: PublicMatch): { lat: number; lng: number } | null {
  const fLat = match.facility?.latitude;
  const fLng = match.facility?.longitude;
  if (fLat != null && fLng != null) return { lat: fLat, lng: fLng };
  if (match.custom_latitude != null && match.custom_longitude != null) {
    return { lat: match.custom_latitude, lng: match.custom_longitude };
  }
  return null;
}

export type DateChip = 'all' | 'today' | 'tomorrow' | 'weekend';

/** Whether a YYYY-MM-DD match date falls inside the given chip's window (local time). */
export function matchesDateChip(dateStr: string, chip: DateChip): boolean {
  if (chip === 'all') return true;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(dateStr + 'T00:00:00');
  const dayDiff = Math.round((date.getTime() - todayStart.getTime()) / 86400000);

  if (chip === 'today') return dayDiff === 0;
  if (chip === 'tomorrow') return dayDiff === 1;
  // weekend: upcoming Saturday & Sunday (or the rest of it if we're already there)
  const dow = todayStart.getDay(); // 0 = Sunday
  const daysToSaturday = dow === 0 ? -1 : 6 - dow;
  return dayDiff >= Math.max(0, daysToSaturday) && dayDiff <= daysToSaturday + 1;
}

export function formatDuration(startTime: string, endTime: string): string {
  const [sH, sM] = startTime.split(':').map(Number);
  const [eH, eM] = endTime.split(':').map(Number);
  let mins = eH * 60 + eM - (sH * 60 + sM);
  if (mins <= 0) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
}
