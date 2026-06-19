export type ViewerMatchStatus = 'joined' | 'requested' | 'waitlisted' | 'invited';

export type MatchParticipantRef = {
  player_id: string;
  status: string;
};

export function getViewerParticipant<T extends MatchParticipantRef>(
  participants: T[] | null | undefined,
  viewerPlayerId: string | null | undefined
): T | undefined {
  if (!viewerPlayerId || !participants?.length) return undefined;
  return participants.find(p => p.player_id === viewerPlayerId);
}

export function getViewerMatchStatus(
  participant: MatchParticipantRef | undefined
): ViewerMatchStatus | null {
  if (!participant) return null;
  switch (participant.status) {
    case 'joined':
      return 'joined';
    case 'requested':
      return 'requested';
    case 'waitlisted':
      return 'waitlisted';
    case 'pending':
      return 'invited';
    default:
      return null;
  }
}
