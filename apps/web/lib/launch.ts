/**
 * Launch moment — Saturday 2026-04-25 00:00 America/Toronto (EDT, UTC-4).
 * Mirrors apps/mobile/src/constants/beta.ts#LAUNCH_MS.
 */
export const LAUNCH_MS = Date.UTC(2026, 3, 25, 4, 0, 0);

export const isLaunched = () => Date.now() >= LAUNCH_MS;

export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isOver: boolean;
};

export function getCountdownParts(now: number, target: number): CountdownParts {
  const diff = target - now;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isOver: true };
  }
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / (1000 * 60)) % 60;
  const hours = Math.floor(diff / (1000 * 60 * 60)) % 24;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return { days, hours, minutes, seconds, isOver: false };
}
