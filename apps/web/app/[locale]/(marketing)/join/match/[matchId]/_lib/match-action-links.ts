import type { WebJoinMatchContext } from './match-context';

/** Builds `YYYYMMDDTHHMMSS` for Google Calendar (floating time + ctz param). */
function toCalStamp(dateStr: string, timeStr: string): string {
  const date = dateStr.replace(/-/g, '');
  const [h = '00', m = '00', s = '00'] = timeStr.split(':');
  return `${date}T${h.padStart(2, '0')}${m.padStart(2, '0')}${s.padStart(2, '0')}`;
}

function addOneHour(timeStr: string): string {
  const [h = 0, m = 0] = timeStr.split(':').map(Number);
  const total = (h * 60 + m + 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:00`;
}

export function getMatchCalendarUrl(match: WebJoinMatchContext): string {
  const facilityName = match.facility?.name;
  const locationTitle = facilityName || match.location_name || 'Match';
  const address = match.facility?.address || match.location_address;
  const city = match.facility?.city;
  const calLocation = [locationTitle, address, city].filter(Boolean).join(', ');

  const calStart = toCalStamp(match.match_date, match.start_time);
  const calEnd = toCalStamp(match.match_date, match.end_time ?? addOneHour(match.start_time));
  const calParams = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${match.sport?.name ?? 'Match'} · Rallia`,
    dates: `${calStart}/${calEnd}`,
    location: calLocation,
  });
  if (match.timezone) calParams.set('ctz', match.timezone);

  return `https://calendar.google.com/calendar/render?${calParams.toString()}`;
}

export function getMatchDirectionsUrl(match: WebJoinMatchContext): string | null {
  const facilityName = match.facility?.name;
  const locationTitle = facilityName || match.location_name || 'Match';
  const address = match.facility?.address || match.location_address;
  const city = match.facility?.city;
  const calLocation = [locationTitle, address, city].filter(Boolean).join(', ');

  const latitude = match.facility?.latitude ?? match.custom_latitude;
  const longitude = match.facility?.longitude ?? match.custom_longitude;

  if (latitude != null && longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }
  if (address || city) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(calLocation)}`;
  }
  return null;
}
