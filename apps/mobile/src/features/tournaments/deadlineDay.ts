/**
 * The last calendar day a game can still be played before a deadline.
 *
 * Deadlines land either at the end of the chosen day (the organizer editor
 * stores 23:59) or just past midnight (draw defaults), so the raw date can be
 * a day off. Anything before 06:00 counts as the night before, which lets
 * every surface print one inclusive "play by" day.
 */
const NIGHT_HOURS = 6;

export function lastPlayableDay(deadlineIso: string): Date {
  return new Date(new Date(deadlineIso).getTime() - NIGHT_HOURS * 3600000);
}
