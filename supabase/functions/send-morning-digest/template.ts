import {
  wrapInLayout,
  renderCtaButton,
  renderDividerAndDisclaimer,
  escapeHtml,
  EMAIL_TOKENS,
} from '../_shared/email-layout.ts';
import { t } from '../_shared/email-translations.ts';

export interface DigestMatch {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  sport_name: string;
  facility_name: string;
  facility_city: string;
  format: 'singles' | 'doubles';
  join_mode: 'direct' | 'request';
  player_expectation: 'casual' | 'competitive' | 'both' | null;
  is_court_free: boolean;
  estimated_cost: number | null;
  court_status: string | null;
  joined_count: number;
  total_spots: number;
  distance_km: number | null;
}

export interface DigestSuggestion {
  opponent_id: string;
  opponent_first_name: string;
  opponent_last_name: string;
  opponent_rating_label: string | null;
  opponent_reputation_tier: string | null;
  sport_name: string;
  facility_name: string;
  facility_city: string;
  overlapping_days_periods: Array<{ day: string; period: string }>;
}

export interface DigestEmailPayload {
  firstName: string | null;
  locale: string;
  matches: DigestMatch[];
  suggestions: DigestSuggestion[];
  appUrl: string;
}

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DAY_ABBR: Record<string, Record<string, string>> = {
  'en-US': {
    monday: 'Mon',
    tuesday: 'Tue',
    wednesday: 'Wed',
    thursday: 'Thu',
    friday: 'Fri',
    saturday: 'Sat',
    sunday: 'Sun',
  },
  'fr-CA': {
    monday: 'Lun',
    tuesday: 'Mar',
    wednesday: 'Mer',
    thursday: 'Jeu',
    friday: 'Ven',
    saturday: 'Sam',
    sunday: 'Dim',
  },
};

const PERIOD_ORDER = ['morning', 'afternoon', 'evening'] as const;

function formatGroupedAvailability(
  slots: Array<{ day: string; period: string }>,
  locale: string
): string {
  if (slots.length === 0) return '';
  const abbr = locale.startsWith('fr') ? DAY_ABBR['fr-CA'] : DAY_ABBR['en-US'];
  const byPeriod: Record<string, Set<string>> = {};
  for (const slot of slots) {
    if (!byPeriod[slot.period]) byPeriod[slot.period] = new Set();
    byPeriod[slot.period].add(slot.day);
  }
  const parts: string[] = [];
  for (const period of PERIOD_ORDER) {
    const days = byPeriod[period];
    if (!days) continue;
    const dayStr = [...days]
      .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
      .slice(0, 3)
      .map(d => abbr[d] ?? d)
      .join(', ');
    const periodLabel = t(locale, `digest.period.${period}`);
    parts.push(`${periodLabel}: ${dayStr}`);
  }
  return parts.join(' · ');
}

// Tier badge display — mirrors TIER_COLORS from shared-services/reputationConfig.ts
const TIER_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  platinum: { bg: '#F0FDFA', text: '#134E4A', label: 'Platinum' },
  gold: { bg: '#FEF9C3', text: '#713F12', label: 'Gold' },
  silver: { bg: '#E2E8F0', text: '#334155', label: 'Silver' },
  bronze: { bg: '#FEF0DF', text: '#92400E', label: 'Bronze' },
};

function formatDuration(startTime: string, endTime: string): string {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
}

function formatMatchDateTime(
  matchDate: string,
  startTime: string,
  endTime: string,
  locale: string
): string {
  // matchDate is "YYYY-MM-DD", startTime/endTime are "HH:MM:SS"
  const [h, m] = startTime.split(':').map(Number);
  const dateObj = new Date(`${matchDate}T00:00:00`);
  const dateStr = dateObj.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeObj = new Date();
  timeObj.setHours(h, m, 0, 0);
  const timeStr = timeObj.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !locale.startsWith('fr'),
  });
  const duration = formatDuration(startTime, endTime);
  return `${dateStr} · ${timeStr} · ${duration}`;
}

function renderMatchCard(match: DigestMatch, locale: string, appUrl: string): string {
  const T = EMAIL_TOKENS;
  const urlLocale = locale.startsWith('fr') ? 'fr-CA' : 'en-US';
  const matchUrl = `${appUrl}/${urlLocale}/match/${match.id}?src=email_digest`;
  const dateTime = formatMatchDateTime(match.match_date, match.start_time, match.end_time, locale);
  const location = [match.facility_name, match.facility_city].filter(Boolean).join(', ');

  // CTA label
  const ctaLabel =
    match.join_mode === 'request'
      ? t(locale, 'digest.askToJoinButton')
      : t(locale, 'digest.joinButton');

  // Distance
  const distanceStr = match.distance_km != null ? `${match.distance_km.toFixed(1)} km` : '';

  // Spots chip
  const spotsLeft = match.total_spots - match.joined_count;
  let spotsLabel: string;
  if (spotsLeft <= 0) {
    spotsLabel = t(locale, 'digest.matchFull');
  } else if (spotsLeft === 1) {
    spotsLabel = t(locale, 'digest.spotLeft');
  } else {
    spotsLabel = t(locale, 'digest.spotsLeft', { count: spotsLeft });
  }
  const spotsColor =
    spotsLeft <= 0 ? T.neutral500 : spotsLeft === 1 ? T.secondary500 : T.primary600;
  const spotsBg =
    spotsLeft <= 0 ? T.neutral100 : spotsLeft === 1 ? `${T.secondary500}18` : `${T.primary600}12`;

  // Format chip
  const formatLabel =
    match.format === 'doubles'
      ? t(locale, 'digest.formatDoubles')
      : t(locale, 'digest.formatSingles');

  // Vibe chip (only when not 'both')
  const vibeLabel =
    match.player_expectation && match.player_expectation !== 'both'
      ? t(
          locale,
          match.player_expectation === 'competitive'
            ? 'digest.vibeLabel.competitive'
            : 'digest.vibeLabel.casual'
        )
      : null;

  // Cost chip
  let costLabel: string | null = null;
  if (match.is_court_free) {
    costLabel = t(locale, 'digest.costFree');
  } else if (match.estimated_cost != null && match.estimated_cost > 0) {
    const perPlayer = (match.estimated_cost / match.total_spots).toFixed(0);
    costLabel = `$${perPlayer}/player`;
  }

  // Court booked badge
  const courtBooked = match.court_status === 'confirmed';

  const chipStyle = (bg: string, color: string) =>
    `display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; background-color: ${bg}; color: ${color}; margin-right: 4px;`;

  const chips = [
    `<span style="${chipStyle(`${T.primary600}12`, T.primary600)}">${escapeHtml(formatLabel)}</span>`,
    `<span style="${chipStyle(spotsBg, spotsColor)}">${escapeHtml(spotsLabel)}</span>`,
    ...(vibeLabel
      ? [
          `<span style="${chipStyle(`${T.primary600}12`, T.primary600)}">${escapeHtml(vibeLabel)}</span>`,
        ]
      : []),
    ...(costLabel
      ? [
          `<span style="${chipStyle(`${T.primary600}12`, T.primary600)}">${escapeHtml(costLabel)}</span>`,
        ]
      : []),
  ].join('');

  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 10px;">
                  <tr>
                    <td class="email-detail-card" style="background-color: ${T.primary50}; border: 1px solid ${T.primary100}; border-radius: 8px; padding: 14px 16px;">

                      <!-- Sport + distance -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 4px;">
                        <tr>
                          <td>
                            <span style="font-size: 11px; font-weight: 700; color: ${T.primary600}; text-transform: uppercase; letter-spacing: 0.07em;">${escapeHtml(match.sport_name)}</span>
                          </td>
                          ${distanceStr ? `<td align="right"><span style="font-size: 11px; color: ${T.neutral500};">${escapeHtml(distanceStr)}</span></td>` : ''}
                        </tr>
                      </table>

                      <!-- Date / time / duration -->
                      <p style="margin: 0 0 3px 0; font-size: 14px; font-weight: 700; color: ${T.neutral900}; line-height: 1.3;">
                        ${escapeHtml(dateTime)}
                      </p>

                      <!-- Location -->
                      ${location ? `<p style="margin: 0 0 8px 0; font-size: 13px; color: ${T.neutral600};">&#128205; ${escapeHtml(location)}</p>` : ''}

                      <!-- Chips: format · spots · vibe · cost -->
                      <p style="margin: 0 0 10px 0; line-height: 1.8;">${chips}</p>

                      <!-- Footer: court booked + CTA -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="vertical-align: middle;">
                            ${courtBooked ? `<span style="font-size: 11px; font-weight: 600; color: ${T.primary600};">&#10003; ${escapeHtml(t(locale, 'digest.courtBooked'))}</span>` : '&nbsp;'}
                          </td>
                          <td align="right" style="vertical-align: middle; padding-left: 12px; white-space: nowrap;">
                            <a href="${matchUrl}" style="display: inline-block; padding: 7px 14px; background-color: ${T.secondary500}; color: #ffffff; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 6px; font-family: Inter, Arial, Helvetica, sans-serif;">
                              ${escapeHtml(ctaLabel)} →
                            </a>
                          </td>
                        </tr>
                      </table>

                    </td>
                  </tr>
                </table>`;
}

function renderSuggestionCard(s: DigestSuggestion, locale: string, appUrl: string): string {
  const T = EMAIL_TOKENS;
  const profileUrl = `${appUrl}/player/${s.opponent_id}?src=email_digest`;
  const name = `${escapeHtml(s.opponent_first_name)} ${escapeHtml(s.opponent_last_name.charAt(0))}.`;
  const location = [s.facility_name, s.facility_city].filter(Boolean).join(', ');
  const availability = formatGroupedAvailability(s.overlapping_days_periods, locale);
  const challengeLabel = t(locale, 'digest.challengeButton');

  // Reputation tier badge
  const tier = s.opponent_reputation_tier?.toLowerCase();
  const tierBadge = tier && TIER_BADGE[tier] ? TIER_BADGE[tier] : null;

  return `
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 10px;">
                  <tr>
                    <td style="background-color: ${T.neutral50}; border: 1px solid ${T.neutral200}; border-radius: 8px; padding: 14px 16px;">

                      <!-- Sport label -->
                      <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; color: ${T.neutral500}; text-transform: uppercase; letter-spacing: 0.07em;">
                        ${escapeHtml(s.sport_name)}
                      </p>

                      <!-- Name + rating + tier badge -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 3px;">
                        <tr>
                          <td style="vertical-align: middle;">
                            <span style="font-size: 15px; font-weight: 700; color: ${T.neutral900};">${name}</span>
                            ${s.opponent_rating_label ? `<span style="font-size: 12px; font-weight: 500; color: ${T.primary600}; margin-left: 6px;">${escapeHtml(s.opponent_rating_label)}</span>` : ''}
                          </td>
                          ${tierBadge ? `<td align="right" style="vertical-align: middle; padding-left: 8px; white-space: nowrap;"><span style="display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; background-color: ${tierBadge.bg}; color: ${tierBadge.text};">${escapeHtml(tierBadge.label)}</span></td>` : ''}
                        </tr>
                      </table>

                      <!-- Location -->
                      ${location ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: ${T.neutral600};">&#128205; ${escapeHtml(location)}</p>` : ''}

                      <!-- Grouped availability -->
                      ${availability ? `<p style="margin: 0 0 10px 0; font-size: 12px; color: ${T.neutral500};">&#128197; ${escapeHtml(availability)}</p>` : '<p style="margin: 0 0 10px 0;"></p>'}

                      <!-- CTA -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="vertical-align: middle;">&nbsp;</td>
                          <td align="right" style="vertical-align: middle; padding-left: 12px; white-space: nowrap;">
                            <a href="${profileUrl}" style="display: inline-block; padding: 7px 14px; border: 2px solid ${T.primary600}; color: ${T.primary600}; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 6px; font-family: Inter, Arial, Helvetica, sans-serif;">
                              ${escapeHtml(challengeLabel)} →
                            </a>
                          </td>
                        </tr>
                      </table>

                    </td>
                  </tr>
                </table>`;
}

function renderSectionHeading(text: string, topSpacing: boolean): string {
  const T = EMAIL_TOKENS;
  return `
                <p style="margin: ${topSpacing ? '24px' : '0'} 0 12px 0; font-size: 11px; font-weight: 700; color: ${T.neutral600}; text-transform: uppercase; letter-spacing: 0.07em;">
                  ${escapeHtml(text)}
                </p>`;
}

export function renderMorningDigestEmail(payload: DigestEmailPayload): {
  subject: string;
  html: string;
} {
  const { firstName, locale, matches, suggestions, appUrl } = payload;
  const T = EMAIL_TOKENS;

  const subject = t(locale, 'digest.subject');
  const preheader = t(locale, 'digest.preheader');
  const heading = firstName
    ? t(locale, 'digest.heading', { firstName: escapeHtml(firstName) })
    : t(locale, 'digest.headingDefault');

  const urlLocale = locale.startsWith('fr') ? 'fr-CA' : 'en-US';
  const browseGamesUrl = `${appUrl}/${urlLocale}/games?src=email_digest`;
  const discoverSuggestionsUrl = `${appUrl}/suggestions?src=email_digest`;

  const matchesSectionHtml =
    matches.length > 0
      ? renderSectionHeading(t(locale, 'digest.matchesSection'), false) +
        matches.map(m => renderMatchCard(m, locale, appUrl)).join('') +
        renderCtaButton(t(locale, 'digest.browseAllGames'), browseGamesUrl)
      : '';

  const suggestionsSectionHtml =
    suggestions.length > 0
      ? renderSectionHeading(t(locale, 'digest.suggestionsSection'), matches.length > 0) +
        suggestions.map(s => renderSuggestionCard(s, locale, appUrl)).join('') +
        renderCtaButton(t(locale, 'digest.discoverAllSuggestions'), discoverSuggestionsUrl)
      : '';

  const content = `
                <h2 style="margin: 0 0 8px 0; font-family: Poppins, Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: ${T.primary600}; letter-spacing: -0.025em; line-height: 1.2;">
                  ${heading}
                </h2>

                <p style="margin: 0 0 28px 0; font-size: 15px; line-height: 1.6; color: ${T.neutral600};">
                  ${escapeHtml(t(locale, 'digest.intro'))}
                </p>

                ${matchesSectionHtml}
                ${suggestionsSectionHtml}

                ${renderDividerAndDisclaimer(t(locale, 'digest.disclaimer'))}`;

  const html = wrapInLayout({
    title: subject,
    content,
    footerNote: t(locale, 'digest.footerNote'),
    preheader,
    locale,
    showUnsubscribe: false,
  });

  return { subject, html };
}
