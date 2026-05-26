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
 * Each toggle is only shown once the pipeline that ACTS on it has shipped —
 * otherwise flipping it does nothing user-visible and is misleading.
 *
 *  • Auto-create: the weekly match-generation pipeline is live (DB trigger →
 *    generate-weekly-matches edge function), so this toggle is revealed.
 *  • Auto-invite: the generate-weekly-matches edge function now invites the
 *    best-fit compatible opponents (get_auto_invite_candidates) to each
 *    auto-created match and notifies them, so this toggle is revealed.
 */
export const WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED = true;
export const WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED = true;
