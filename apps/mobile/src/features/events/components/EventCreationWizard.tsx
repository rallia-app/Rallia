/**
 * EventCreationWizard — one entry point for every event format.
 *
 * Picks a format, then runs that format's engine wizard with the choice
 * already applied. Callers no longer need to know which formats exist or which
 * wizard runs them; they ask for event creation and optionally narrow the
 * formats on offer.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  lightTheme,
  darkTheme,
  primary,
  neutral,
  status as statusColors,
} from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';

import { useSport } from '../../../context';
import { TournamentCreationWizard } from '../../tournaments/components/TournamentCreationWizard';
import { LeagueCreationWizard } from '../../leagues/components/LeagueCreationWizard';
import { EVENT_KINDS, eventKindDescriptor, type EventKind } from '../eventKinds';

import { EventFormatPicker } from './EventFormatPicker';

const BASE_WHITE = '#ffffff';

export interface EventCreationWizardProps {
  onClose: () => void;
  /** Leaving the first screen: back to whatever opened the wizard. */
  onBackToLanding: () => void;
  onSuccess: (kind: EventKind, eventId: string) => void;
  /** Tournament success screen's "Share invite link". */
  onShareInvite?: (kind: EventKind, tournamentId: string) => void;
  /**
   * Restricts the formats offered. A single entry skips the picker, so a
   * screen with a format-specific CTA opens straight into its wizard.
   */
  kinds?: EventKind[];
}

export const EventCreationWizard: React.FC<EventCreationWizardProps> = ({
  onClose,
  onBackToLanding,
  onSuccess,
  onShareInvite,
  kinds,
}) => {
  const { theme } = useTheme();
  const { selectedSport } = useSport();
  const isDark = theme === 'dark';

  const offered = useMemo(
    () => (kinds ? EVENT_KINDS.filter(d => kinds.includes(d.kind)) : EVENT_KINDS),
    [kinds]
  );
  // One format on offer is not a choice: open its wizard directly, and let its
  // back chevron leave the wizard entirely rather than land on a one-card picker.
  const onlyKind = offered.length === 1 ? offered[0].kind : null;

  const [picked, setPicked] = useState<EventKind | null>(onlyKind);
  const [confirmed, setConfirmed] = useState(onlyKind != null);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonInactive: themeColors.muted,
      buttonTextActive: BASE_WHITE,
      progressActive: isDark ? primary[500] : primary[600],
      progressInactive: themeColors.muted,
      error: statusColors.error.DEFAULT,
    }),
    [themeColors, isDark]
  );

  /** Back out of an engine wizard: to the picker, or out entirely. */
  const handleBackFromEngine = useCallback(() => {
    if (onlyKind) {
      onBackToLanding();
      return;
    }
    setConfirmed(false);
  }, [onlyKind, onBackToLanding]);

  if (!confirmed || picked == null) {
    return (
      <EventFormatPicker
        kinds={kinds}
        selected={picked}
        onSelect={setPicked}
        onContinue={() => setConfirmed(true)}
        onBack={onBackToLanding}
        onClose={onClose}
        sportName={selectedSport?.display_name ?? selectedSport?.name ?? ''}
        sportKey={selectedSport?.name ?? 'tennis'}
        colors={colors}
      />
    );
  }

  const descriptor = eventKindDescriptor(picked);

  if (descriptor.engine === 'league') {
    return (
      <LeagueCreationWizard
        onClose={onClose}
        onBackToLanding={handleBackFromEngine}
        onSuccess={leagueId => onSuccess(picked, leagueId)}
      />
    );
  }

  return (
    <TournamentCreationWizard
      onClose={onClose}
      onBackToLanding={handleBackFromEngine}
      onSuccess={tournamentId => onSuccess(picked, tournamentId)}
      onShareInvite={
        onShareInvite ? tournamentId => onShareInvite(picked, tournamentId) : undefined
      }
      initialStructure={descriptor.bracketType}
    />
  );
};
