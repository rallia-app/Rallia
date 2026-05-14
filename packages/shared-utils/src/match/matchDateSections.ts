export type UpcomingDateSection = 'today' | 'tomorrow' | 'thisWeek' | 'nextWeek' | 'later';
export type PastDateSection = 'today' | 'yesterday' | 'lastWeek' | 'earlier';

function toDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function resolveDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(value + 'T00:00:00');
}

export function getUpcomingDateSection(matchDate: Date | string): UpcomingDateSection {
  const matchDateOnly = toDateOnly(resolveDate(matchDate));
  const today = toDateOnly(new Date());

  const diff = matchDateOnly.getTime() - today.getTime();
  const dayMs = 86_400_000;

  if (diff === 0) return 'today';
  if (diff === dayMs) return 'tomorrow';
  if (diff < 7 * dayMs) return 'thisWeek';
  if (diff < 14 * dayMs) return 'nextWeek';
  return 'later';
}

export function getPastDateSection(matchDate: Date | string): PastDateSection {
  const matchDateOnly = toDateOnly(resolveDate(matchDate));
  const today = toDateOnly(new Date());

  const diff = today.getTime() - matchDateOnly.getTime();
  const dayMs = 86_400_000;

  if (diff === 0) return 'today';
  if (diff === dayMs) return 'yesterday';
  if (diff < 7 * dayMs) return 'lastWeek';
  return 'earlier';
}

export const UPCOMING_SECTION_ORDER: UpcomingDateSection[] = [
  'today',
  'tomorrow',
  'thisWeek',
  'nextWeek',
  'later',
];

export const PAST_SECTION_ORDER: PastDateSection[] = ['today', 'yesterday', 'lastWeek', 'earlier'];
