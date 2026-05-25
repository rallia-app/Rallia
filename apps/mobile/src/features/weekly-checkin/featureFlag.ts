/**
 * Master gate for the weekly check-in wizard.
 *
 * Flip to `true` to re-enable the auto-opener at app launch and the home
 * availability-refresh banner (whose CTA navigates into the wizard). The
 * `WeeklyCheckIn` route is still registered in AppNavigator when this is
 * false — it's just unreachable from the UI.
 */
export const WEEKLY_CHECKIN_ENABLED = true;

/**
 * Step 3 auto-create / auto-invite toggles.
 *
 * These capture the player's intent into `player_check_in_preferences`, but
 * the follow-up work that ACTS on them (match-creation pipeline +
 * auto-invite pipeline) hasn't shipped. Showing the toggles is misleading
 * because flipping them does nothing user-visible yet.
 *
 * Hidden for now. The hook keeps the underlying state defaulted to `true`
 * so when the follow-up work lands, existing users already have the
 * preference set in the expected default.
 *
 * Flip to `true` to reveal the toggles once the match-creation pipeline is
 * ready to consume the preferences.
 */
export const WEEKLY_CHECKIN_AUTO_TOGGLES_ENABLED = false;
