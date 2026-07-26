import { cn } from '@/lib/utils';

/**
 * Web twin of apps/mobile/src/components/SportIcon.tsx — the same two glyphs
 * (assets/icons/tennis.svg and pickleball.svg), inlined with currentColor so the
 * parent sets colour with a text utility. Same fallback too: unknown sports get
 * the tennis mark rather than a broken image.
 */
const TENNIS_PATH =
  'm137-160-57-56 164-164q31-31 42.5-77.5T298-600q0-58 26-114t74-104q91-91 201-103t181 61q72 72 60 182T738-478q-48 48-104 74t-114 26q-97 0-142 11t-77 43L137-160Zm275-334q47 46 127 34t143-75q64-64 76.5-143.5T724-803q-48-48-125.5-36T456-763q-63 63-76.5 142.5T412-494ZM607-87q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113T833-87q-47 47-113 47T607-87Zm169.5-56.5Q800-167 800-200t-23.5-56.5Q753-280 720-280t-56.5 23.5Q640-233 640-200t23.5 56.5Q687-120 720-120t56.5-23.5ZM720-200Z';

const PICKLEBALL_PATH =
  'M283-381q19 19 42 28t48 9q25 0 48-9t42-28l36-36q19-19 28-42t9-48q0-25-9-47.5T499-596L347-748q-12-12-28.5-12T290-748L132-589q-12 12-12 28t12 28l151 152ZM743-80 508-315q-29 26-64.5 38T372-265q-40 0-77.5-15T227-325L75-476q-17-17-26-39.5T40-561q0-23 9-45.5T75-646l159-159q17-17 39.5-26t45.5-9q23 0 45.5 9t39.5 26l151 152q30 30 45 67.5t15 77.5q0 36-12.5 71.5T564-372l236 236-57 56Zm37-520q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T840-740q0-25-17.5-42.5T780-800q-25 0-42.5 17.5T720-740q0 25 17.5 42.5T780-680Zm0-60ZM326-554Z';

export function SportIcon({
  sportName,
  className,
}: {
  /** Sport name (e.g. 'tennis', 'pickleball'). Case-insensitive; unknown falls back to tennis. */
  sportName: string;
  className?: string;
}) {
  const isPickleball = sportName?.toLowerCase() === 'pickleball';

  return (
    <svg
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn('size-5', className)}
    >
      <path d={isPickleball ? PICKLEBALL_PATH : TENNIS_PATH} />
    </svg>
  );
}
