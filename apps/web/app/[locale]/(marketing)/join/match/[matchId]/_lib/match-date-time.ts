import {
  formatIntuitiveDateInTimezone,
  formatTimeInTimezone,
  getTimeDifferenceFromNow,
} from '@rallia/shared-utils';

export type MatchDateTimeDisplay = {
  dateLabel: string;
  startTimeLabel: string;
  durationLabel: string;
  isUrgent: boolean;
};

function addOneHour(timeStr: string): string {
  const [h = 0, m = 0] = timeStr.split(':').map(Number);
  const total = (h * 60 + m + 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:00`;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) {
    const mm = minutes.toString().padStart(2, '0');
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

export function getMatchDateTimeDisplay(
  match: {
    match_date: string;
    start_time: string;
    end_time: string | null;
    timezone: string | null;
  },
  locale: string,
  resolveDateLabel: (translationKey: string | null, label: string) => string
): MatchDateTimeDisplay {
  const tz = match.timezone || 'UTC';
  const msDiff = getTimeDifferenceFromNow(match.match_date, match.start_time, tz);
  const hoursDiff = Math.floor(msDiff / (1000 * 60 * 60));
  const isUrgent = hoursDiff >= 0 && hoursDiff < 3;

  const dateResult = formatIntuitiveDateInTimezone(match.match_date, tz, locale);
  const dateLabel = dateResult.translationKey
    ? resolveDateLabel(dateResult.translationKey, dateResult.label)
    : dateResult.label;

  const startResult = formatTimeInTimezone(match.match_date, match.start_time, tz, locale);
  const endTime = match.end_time ?? addOneHour(match.start_time);
  const [startH, startM] = match.start_time.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  let durationMin = endH * 60 + endM - (startH * 60 + startM);
  if (durationMin <= 0) durationMin += 24 * 60;
  const durationHours = Math.floor(durationMin / 60);
  const durationRemMin = durationMin % 60;
  const durationLabel =
    durationRemMin > 0
      ? `${durationHours}h${durationRemMin.toString().padStart(2, '0')}`
      : `${durationHours}h`;

  return {
    dateLabel,
    startTimeLabel: startResult.formattedTime,
    durationLabel,
    isUrgent,
  };
}
