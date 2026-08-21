/**
 * Styles shared by the league detail screen and its tab panes.
 *
 * Lifted verbatim out of LeagueDetail so the panes can move into their own
 * files without each one forking the parts of this sheet it happens to touch.
 */

import { StyleSheet } from 'react-native';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

export const styles = StyleSheet.create({
  seasonReasonInput: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
    minHeight: 72,
    textAlignVertical: 'top',
  },
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[6],
  },
  centeredText: { marginTop: spacingPixels[3], textAlign: 'center' },
  centeredSubtext: { marginTop: spacingPixels[2], textAlign: 'center' },
  retryButton: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  heroFixed: {
    paddingBottom: spacingPixels[2],
  },
  heroBanner: {
    position: 'relative',
  },
  heroBannerTopRow: {
    position: 'absolute',
    top: spacingPixels[3],
    left: spacingPixels[4],
    right: spacingPixels[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[2],
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[3],
    gap: spacingPixels[1],
  },
  scrimText: {
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  heroChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    flexShrink: 1,
  },
  heroTextAction: {
    paddingVertical: spacingPixels[1.5],
    paddingHorizontal: spacingPixels[1],
  },
  screenScroll: { flex: 1 },
  screenScrollContent: { flexGrow: 1 },
  tabBarSticky: {
    paddingTop: spacingPixels[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacingPixels[5],
    paddingHorizontal: spacingPixels[4],
  },
  tabItem: {
    alignItems: 'center',
    paddingTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  tabUnderline: {
    alignSelf: 'stretch',
    height: 2,
    borderRadius: 1,
  },
  tabContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  playersTabContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[8],
  },
  statusBadge: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  section: { marginBottom: spacingPixels[5] },
  sectionTitle: {
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoRowLabel: {
    marginRight: spacingPixels[3],
  },
  infoRowValue: {
    flex: 1,
    textAlign: 'right',
  },
  stackedBlock: {
    padding: spacingPixels[4],
    gap: spacingPixels[1],
  },
  stackedValue: {
    lineHeight: 20,
  },
  stepperCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
  },
  lifecycleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[3],
  },
  flex1: {
    flex: 1,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepperStep: {
    flex: 1,
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  stepperDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperConnector: {
    height: 2,
    flex: 0.4,
    marginTop: 13,
    borderRadius: 1,
  },
  ctaCard: {
    borderWidth: 1,
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    gap: spacingPixels[4],
  },
  ctaCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
  },
  ctaCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCardTextBlock: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  ctaCardDescription: { lineHeight: 19 },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    paddingVertical: spacingPixels[3],
  },
  statSegment: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacingPixels[2],
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  overviewActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3.5],
  },
  overviewActionLabel: {
    flex: 1,
  },
  overviewActionBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  overviewInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  overviewInfoIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewInfoTexts: {
    flex: 1,
    gap: 1,
  },
  overviewDescription: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  membersPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  membersPreviewAvatars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  membersPreviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  membersPreviewAvatarOverlap: {
    marginLeft: -10,
  },
  membersPreviewAvatarImg: {
    width: '100%',
    height: '100%',
  },
  dockedBar: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[3],
  },
  dockedBarHint: {
    textAlign: 'center',
    lineHeight: 16,
  },
  participantEmpty: {
    padding: spacingPixels[4],
    alignItems: 'center',
  },
  pendingSection: { marginBottom: spacingPixels[4] },
  leagueFullHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.md,
    marginBottom: spacingPixels[2],
  },
  leagueFullHintText: {
    flex: 1,
  },
  queueBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingLeft: spacingPixels[14],
    paddingBottom: spacingPixels[2],
    marginTop: -spacingPixels[1],
  },
  segmentBar: {
    marginBottom: spacingPixels[4],
  },
  // Roster count sits inside the Section card, above the first row's divider.
  rosterCountLabel: {
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
    letterSpacing: 0.5,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
  },
  buttonDisabled: { opacity: 0.6 },
  inviteButton: {
    marginBottom: spacingPixels[3],
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
    padding: spacingPixels[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasonRowMain: { flex: 1, gap: spacingPixels[0.5] },
  seasonRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  seasonStatusPill: {
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  seasonActionButton: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
  },
  seasonCard: {
    padding: spacingPixels[4],
    gap: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasonCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  seasonCardInfo: { flex: 1, gap: spacingPixels[0.5] },
  seasonCtaButton: {
    borderWidth: 1,
    borderRadius: radiusPixels.md,
    paddingVertical: spacingPixels[2.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonCancelAction: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
  },
  standingsSeasonBar: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
  },
  standingsSeasonChip: {
    borderWidth: 1,
    borderRadius: radiusPixels.full,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2.5],
  },
  standingHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  standingRank: { width: 28 },
  standingName: { flex: 1 },
  standingWl: { width: 56, textAlign: 'right' },
  standingPts: { width: 44, textAlign: 'right' },
  sessionEmptyText: {
    textAlign: 'center',
  },
});
