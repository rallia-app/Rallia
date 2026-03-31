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

export function formatDuration(startTime: string, endTime: string): string {
  const [sH, sM] = startTime.split(':').map(Number);
  const [eH, eM] = endTime.split(':').map(Number);
  let mins = eH * 60 + eM - (sH * 60 + sM);
  if (mins <= 0) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
}
