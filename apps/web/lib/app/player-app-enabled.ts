/** The player web app is parked mid-build; every surface stays hidden until a coherent slice exists. */
export function isPlayerAppEnabled(): boolean {
  return process.env.PLAYER_APP_ENABLED === 'true';
}
