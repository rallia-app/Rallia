import { AdminUserFeedbackSection } from '@/components/admin-user-feedback-section';
import { AdminUserProfileHeader } from '@/components/admin-user-profile-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { Calendar, Hand, Mail, MapPin, Phone, Shield, Star, Trophy, User } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

function capitalize(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations('admin.users.detail');
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profile')
    .select('first_name, last_name')
    .eq('id', id)
    .single();

  const name = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    : t('title');

  return {
    title: `${name} - ${t('title')}`,
  };
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const t = await getTranslations('admin.users.detail');
  const supabase = await createClient();
  const adminDb = createServiceRoleClient();

  // Fetch profile (use service role to bypass RLS for admin view)
  const { data: profile, error: profileError } = await adminDb
    .from('profile')
    .select(
      `
      id, first_name, last_name, display_name, email, phone, bio,
      birth_date, account_status, is_active, email_verified,
      phone_verified, onboarding_completed, profile_picture_url,
      preferred_locale, referral_code, referred_by,
      created_at, updated_at, last_active_at
    `
    )
    .eq('id', id)
    .single();

  if (profileError || !profile) {
    notFound();
  }

  // Fetch admin data (may not exist)
  const { data: adminData } = await adminDb
    .from('admin')
    .select('id, role, assigned_at, notes, permissions')
    .eq('id', id)
    .single();

  // Fetch player data (may not exist)
  const { data: playerData } = await adminDb
    .from('player')
    .select(
      `
      id, gender, playing_hand, address, city, province, country, postal_code,
      reputation_score, max_travel_distance, last_seen_at, chat_rules_agreed_at,
      privacy_show_age, privacy_show_availability, privacy_show_location, privacy_show_stats,
      notification_match_requests, notification_messages, notification_reminders, push_notifications_enabled
    `
    )
    .eq('id', id)
    .single();

  // Fetch player-specific related data
  let playerSports: Array<{
    id: string;
    is_primary: boolean | null;
    is_active: boolean | null;
    preferred_match_type: string | null;
    preferred_match_duration: string | null;
    preferred_play_style: string | null;
    preferred_play_attributes: string[] | null;
    preferred_court: string | null;
    sport: { name: string; display_name: string; slug: string } | null;
    preferred_facility: { name: string } | null;
  }> = [];
  type PlayerRatingData = {
    id: string;
    badge_status: string;
    is_certified: boolean;
    certified_via: string | null;
    certified_at: string | null;
    approved_proofs_count: number;
    peer_evaluation_average: number | null;
    peer_evaluation_count: number;
    referrals_count: number;
    notes: string | null;
    source: string | null;
    expires_at: string | null;
    level_changed_at: string | null;
    assigned_at: string;
    rating_score: {
      label: string;
      value: number | null;
      skill_level: string | null;
      rating_system: { name: string; code: string } | null;
    } | null;
    previous_rating_score: { label: string; skill_level: string | null } | null;
  };
  let playerRatingData: PlayerRatingData | null = null;
  let ratingProofs: Array<{
    id: string;
    proof_type: string;
    title: string;
    description: string | null;
    external_url: string | null;
    status: string;
    is_active: boolean;
    review_notes: string | null;
    reviewed_at: string | null;
    created_at: string;
    rating_score: { label: string } | null;
  }> = [];
  let ratingReferences: Array<{
    id: string;
    status: string;
    rating_supported: boolean;
    message: string | null;
    response_message: string | null;
    responded_at: string | null;
    expires_at: string;
    created_at: string;
    rating_score: { label: string } | null;
    referee: { first_name: string; last_name: string | null } | null;
  }> = [];
  let reportsAbout: Array<{
    id: string;
    report_type: string;
    description: string | null;
    status: string;
    priority: string | null;
    action_taken: string | null;
    admin_notes: string | null;
    created_at: string;
    reporter: { first_name: string; last_name: string | null } | null;
  }> = [];
  let matchFeedbackReceived: Array<{
    id: string;
    showed_up: boolean;
    was_late: boolean | null;
    star_rating: number | null;
    comments: string | null;
    created_at: string;
    reviewer: { first_name: string; last_name: string | null } | null;
  }> = [];
  let matchStats = {
    total: 0,
    played: 0,
    noShows: 0,
    lateArrivals: 0,
    cancellations: 0,
    avgStarRating: null as number | null,
  };
  let bans: Array<{
    id: string;
    reason: string;
    ban_type: string;
    banned_at: string;
    expires_at: string | null;
    is_active: boolean;
    notes: string | null;
    lift_reason: string | null;
    lifted_at: string | null;
  }> = [];
  let feedback: Array<{
    id: string;
    category: string;
    subject: string;
    message: string;
    status: string;
    app_version: string | null;
    admin_notes: string | null;
    created_at: string;
  }> = [];

  // Fetch organization memberships (any user can be a member)
  const { data: orgMemberships } = await adminDb
    .from('organization_member')
    .select('id, role, joined_at, organization(name, slug)')
    .eq('user_id', id);

  if (playerData) {
    const [
      sportsRes,
      bansRes,
      feedbackRes,
      ratingRes,
      reportsAboutRes,
      matchFeedbackRes,
      matchStatsRes,
    ] = await Promise.all([
      adminDb
        .from('player_sport')
        .select(
          `
          id, is_primary, is_active,
          preferred_match_type, preferred_match_duration,
          preferred_play_style, preferred_play_attributes,
          preferred_court,
          sport(name, display_name, slug),
          preferred_facility:facility(name)
        `
        )
        .eq('player_id', id),
      adminDb
        .from('player_ban')
        .select(
          'id, reason, ban_type, banned_at, expires_at, is_active, notes, lift_reason, lifted_at'
        )
        .eq('player_id', id)
        .order('banned_at', { ascending: false }),
      adminDb
        .from('feedback')
        .select('id, category, subject, message, status, app_version, admin_notes, created_at')
        .eq('player_id', id)
        .order('created_at', { ascending: false }),
      adminDb
        .from('player_rating_score')
        .select(
          `
          id, badge_status, is_certified, certified_via, certified_at,
          approved_proofs_count, peer_evaluation_average, peer_evaluation_count,
          referrals_count, notes, source, expires_at, level_changed_at,
          assigned_at,
          rating_score!player_rating_scores_rating_score_id_fkey(label, value, skill_level, rating_system(name, code)),
          previous_rating_score:rating_score!player_rating_score_previous_rating_score_id_fkey(label, skill_level)
        `
        )
        .eq('player_id', id)
        .limit(1)
        .maybeSingle(),
      // Reports about this player
      adminDb
        .from('player_report')
        .select(
          'id, report_type, description, status, priority, action_taken, admin_notes, created_at, reporter:reporter_id(first_name, last_name)'
        )
        .eq('reported_player_id', id)
        .order('created_at', { ascending: false }),
      // Match feedback received from opponents
      adminDb
        .from('match_feedback')
        .select(
          'id, showed_up, was_late, star_rating, comments, created_at, reviewer:reviewer_id(first_name, last_name)'
        )
        .eq('opponent_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      // Match participation stats
      adminDb
        .from('match_participant')
        .select('id, status, match_outcome, showed_up, was_late, star_rating, feedback_completed')
        .eq('player_id', id),
    ]);

    playerSports = (sportsRes.data ?? []) as typeof playerSports;
    const ratingRaw = ratingRes.data as unknown as PlayerRatingData | null;
    if (ratingRaw) {
      playerRatingData = ratingRaw;
    }
    bans = (bansRes.data ?? []) as typeof bans;
    feedback = (feedbackRes.data ?? []) as typeof feedback;
    reportsAbout = (reportsAboutRes.data ?? []) as unknown as typeof reportsAbout;
    matchFeedbackReceived = (matchFeedbackRes.data ??
      []) as unknown as typeof matchFeedbackReceived;

    // Second batch: queries that depend on rating data
    if (ratingRaw) {
      const ratingId = ratingRaw.id;
      const [proofsRes, referencesRes] = await Promise.all([
        adminDb
          .from('rating_proof')
          .select(
            `
            id, proof_type, title, description, external_url, status, is_active,
            review_notes, reviewed_at, created_at,
            rating_score(label)
          `
          )
          .eq('player_rating_score_id', ratingId)
          .order('created_at', { ascending: false }),
        adminDb
          .from('rating_reference_request')
          .select(
            `
            id, status, rating_supported, message, response_message, responded_at, expires_at, created_at,
            rating_score(label),
            referee:referee_id(first_name, last_name)
          `
          )
          .eq('requester_id', id)
          .order('created_at', { ascending: false }),
      ]);
      ratingProofs = (proofsRes.data ?? []) as unknown as typeof ratingProofs;
      ratingReferences = (referencesRes.data ?? []) as unknown as typeof ratingReferences;
    }

    // Compute match stats
    const participants = matchStatsRes.data ?? [];
    matchStats = {
      total: participants.length,
      played: participants.filter(p => p.match_outcome === 'played').length,
      noShows: participants.filter(p => p.showed_up === false).length,
      lateArrivals: participants.filter(p => p.was_late === true).length,
      cancellations: participants.filter(
        p => p.match_outcome === 'mutual_cancel' || p.match_outcome === 'opponent_no_show'
      ).length,
      avgStarRating: (() => {
        const ratings = participants.filter(p => p.star_rating != null).map(p => p.star_rating!);
        return ratings.length > 0
          ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
          : null;
      })(),
    };
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(dateString));
  };

  const displayName =
    (profile.first_name && profile.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : profile.first_name) ||
    profile.display_name ||
    '-';

  const isAdmin = !!adminData;
  const isPlayer = !!playerData;
  const backTab = isPlayer ? 'players' : 'admins';

  return (
    <div className="flex flex-col w-full gap-8">
      {/* Header */}
      <AdminUserProfileHeader
        userName={displayName}
        description={profile.email}
        backLabel={t('backToUsers')}
        backHref={`/admin/users?tab=${backTab}`}
      />

      {/* Profile Information */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-muted/30 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{t('sections.profileInfo')}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={profile.account_status === 'active' ? 'default' : 'secondary'}
                className="font-medium"
              >
                {capitalize(profile.account_status)}
              </Badge>
              {profile.onboarding_completed && (
                <Badge variant="outline" className="font-medium">
                  {t('fields.onboarding')}
                </Badge>
              )}
              {profile.email_verified && (
                <Badge variant="outline" className="font-medium">
                  {t('fields.emailVerified')}
                </Badge>
              )}
              {profile.phone_verified && (
                <Badge variant="outline" className="font-medium">
                  {t('fields.phoneVerified')}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {profile.bio && (
            <div className="bg-muted/20 rounded-lg p-4">
              <p className="text-sm font-medium text-muted-foreground mb-2 mt-0">
                {t('fields.bio')}
              </p>
              <p className="text-base leading-relaxed m-0">{profile.bio}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {profile.email && (
              <InfoItem icon={<Mail className="h-4 w-4 text-primary" />} label={t('fields.email')}>
                <a
                  href={`mailto:${profile.email}`}
                  className="text-sm font-medium hover:underline hover:text-primary transition-colors"
                >
                  {profile.email}
                </a>
              </InfoItem>
            )}

            {profile.phone && (
              <InfoItem icon={<Phone className="h-4 w-4 text-primary" />} label={t('fields.phone')}>
                <a
                  href={`tel:${profile.phone}`}
                  className="text-sm font-medium hover:underline hover:text-primary transition-colors"
                >
                  {profile.phone}
                </a>
              </InfoItem>
            )}

            {playerData &&
              (playerData.address ||
                playerData.city ||
                playerData.province ||
                playerData.country) && (
                <InfoItem
                  icon={<MapPin className="h-4 w-4 text-primary" />}
                  label={t('fields.location')}
                >
                  <p className="text-sm font-medium m-0">
                    {[
                      playerData.address,
                      playerData.city,
                      playerData.province,
                      playerData.country?.toUpperCase(),
                      playerData.postal_code,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </InfoItem>
              )}

            {profile.birth_date && (
              <InfoItem
                icon={<Calendar className="h-4 w-4 text-primary" />}
                label={t('fields.birthDate')}
              >
                <p className="text-sm font-medium m-0">{formatDate(profile.birth_date)}</p>
              </InfoItem>
            )}

            {playerData?.gender && (
              <InfoItem icon={<User className="h-4 w-4 text-primary" />} label={t('fields.gender')}>
                <p className="text-sm font-medium m-0">{t(`gender.${playerData.gender}`)}</p>
              </InfoItem>
            )}

            {playerData?.playing_hand && (
              <InfoItem
                icon={<Hand className="h-4 w-4 text-primary" />}
                label={t('fields.playingHand')}
              >
                <p className="text-sm font-medium m-0">
                  {t(`playingHand.${playerData.playing_hand}`)}
                </p>
              </InfoItem>
            )}

            {playerData && (
              <InfoItem
                icon={<Star className="h-4 w-4 text-primary" />}
                label={t('fields.reputation')}
              >
                <p className="text-sm font-medium m-0">{playerData.reputation_score}</p>
              </InfoItem>
            )}

            {playerData?.max_travel_distance && (
              <InfoItem
                icon={<MapPin className="h-4 w-4 text-primary" />}
                label={t('fields.maxTravel')}
              >
                <p className="text-sm font-medium m-0">{playerData.max_travel_distance} km</p>
              </InfoItem>
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-muted/20 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 mt-0">
                {t('fields.createdAt')}
              </p>
              <p className="text-sm font-semibold m-0">{formatDate(profile.created_at)}</p>
            </div>
            <div className="text-center p-3 bg-muted/20 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 mt-0">
                {t('fields.lastActive')}
              </p>
              <p className="text-sm font-semibold m-0">{formatDate(profile.last_active_at)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Role Section */}
      {isAdmin && adminData && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {t('sections.adminRole')}
              </CardTitle>
              <Badge variant="outline" className="font-medium">
                {capitalize(adminData.role)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <InfoItem
                icon={<Calendar className="h-4 w-4 text-primary" />}
                label={t('fields.assignedAt')}
              >
                <p className="text-sm font-medium m-0">{formatDate(adminData.assigned_at)}</p>
              </InfoItem>
              {adminData.notes && (
                <InfoItem
                  icon={<Mail className="h-4 w-4 text-primary" />}
                  label={t('fields.notes')}
                >
                  <p className="text-sm font-medium m-0">{adminData.notes}</p>
                </InfoItem>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sport Profiles Section */}
      {isPlayer && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              {t('sections.sportProfiles')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {playerSports.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 m-0">{t('sport.empty')}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {playerSports.map(ps => {
                  return (
                    <div key={ps.id} className="border rounded-lg overflow-hidden">
                      {/* Card header */}
                      <div className="flex items-center justify-between p-4 bg-muted/30 border-b">
                        <span className="font-semibold">
                          {ps.sport?.display_name ?? ps.sport?.name ?? '-'}
                        </span>
                        <div className="flex gap-2">
                          {ps.is_primary && (
                            <Badge variant="default" className="text-xs">
                              {t('sport.primary')}
                            </Badge>
                          )}
                          {ps.is_active === false && (
                            <Badge variant="secondary" className="text-xs">
                              {t('sport.inactive')}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="p-4 space-y-3">
                        {/* Rating (shown on primary sport card) */}
                        {ps.is_primary && playerRatingData?.rating_score && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              {t('sport.rating')}
                            </span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {playerRatingData.rating_score.label}
                              </Badge>
                              {playerRatingData.rating_score.skill_level && (
                                <Badge
                                  variant={
                                    playerRatingData.rating_score.skill_level === 'professional'
                                      ? 'default'
                                      : 'secondary'
                                  }
                                  className="text-xs"
                                >
                                  {t(
                                    `sport.skillLevels.${playerRatingData.rating_score.skill_level}`
                                  )}
                                </Badge>
                              )}
                              {playerRatingData.is_certified && (
                                <Badge variant="default" className="text-xs">
                                  {t('sport.certified')}
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Play style */}
                        {ps.preferred_play_style && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              {t('sport.playStyle')}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {t(`sport.playStyles.${ps.preferred_play_style}`)}
                            </Badge>
                          </div>
                        )}

                        {/* Preferences grid */}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {ps.preferred_match_type && (
                            <div>
                              <p className="text-xs text-muted-foreground m-0">
                                {t('sport.matchType')}
                              </p>
                              <p className="font-medium m-0">
                                {t(`sport.matchTypes.${ps.preferred_match_type}`)}
                              </p>
                            </div>
                          )}
                          {ps.preferred_match_duration && (
                            <div>
                              <p className="text-xs text-muted-foreground m-0">
                                {t('sport.duration')}
                              </p>
                              <p className="font-medium m-0">
                                {ps.preferred_match_duration === 'custom'
                                  ? capitalize(ps.preferred_match_duration)
                                  : t('sport.durationMinutes', {
                                      minutes: ps.preferred_match_duration,
                                    })}
                              </p>
                            </div>
                          )}
                          {ps.preferred_court && (
                            <div>
                              <p className="text-xs text-muted-foreground m-0">
                                {t('sport.court')}
                              </p>
                              <p className="font-medium m-0">{capitalize(ps.preferred_court)}</p>
                            </div>
                          )}
                          {ps.preferred_facility && (
                            <div>
                              <p className="text-xs text-muted-foreground m-0">
                                {t('sport.facility')}
                              </p>
                              <p className="font-medium m-0">{ps.preferred_facility.name}</p>
                            </div>
                          )}
                        </div>

                        {/* Play attributes */}
                        {ps.preferred_play_attributes &&
                          ps.preferred_play_attributes.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0 mb-2">
                                {t('sport.attributes')}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {ps.preferred_play_attributes.map(attr => (
                                  <Badge key={attr} variant="outline" className="text-xs">
                                    {t(`sport.playAttributes.${attr}`)}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rating & Certification Section */}
      {isPlayer && playerRatingData && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Star className="h-5 w-5" />
                {t('sections.rating')}
              </CardTitle>
              <div className="flex gap-2">
                <Badge
                  variant={
                    playerRatingData.badge_status === 'certified'
                      ? 'default'
                      : playerRatingData.badge_status === 'disputed'
                        ? 'destructive'
                        : 'secondary'
                  }
                  className="text-xs"
                >
                  {t(`rating.badgeStatuses.${playerRatingData.badge_status}`)}
                </Badge>
                {playerRatingData.rating_score?.rating_system && (
                  <Badge variant="outline" className="text-xs">
                    {playerRatingData.rating_score.rating_system.name}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            {/* Rating level info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {playerRatingData.rating_score && (
                <StatCard
                  label={t('rating.currentLevel')}
                  value={`${playerRatingData.rating_score.label}${playerRatingData.rating_score.skill_level ? ` (${t(`sport.skillLevels.${playerRatingData.rating_score.skill_level}`)})` : ''}`}
                />
              )}
              {playerRatingData.previous_rating_score && (
                <StatCard
                  label={t('rating.previousLevel')}
                  value={playerRatingData.previous_rating_score.label}
                />
              )}
              {playerRatingData.certified_via && (
                <StatCard
                  label={t('rating.certifiedVia')}
                  value={t(`rating.certificationMethods.${playerRatingData.certified_via}`)}
                />
              )}
              {playerRatingData.source && (
                <StatCard
                  label={t('rating.source')}
                  value={playerRatingData.source.toUpperCase()}
                />
              )}
            </div>

            {/* Peer evaluation & proof stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label={t('rating.peerEvalAvg')}
                value={
                  playerRatingData.peer_evaluation_average != null
                    ? `${Math.round(playerRatingData.peer_evaluation_average * 100)}%`
                    : '-'
                }
              />
              <StatCard
                label={t('rating.peerEvalCount')}
                value={playerRatingData.peer_evaluation_count}
              />
              <StatCard
                label={t('rating.approvedProofs')}
                value={playerRatingData.approved_proofs_count}
              />
              <StatCard label={t('rating.referrals')} value={playerRatingData.referrals_count} />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {playerRatingData.certified_at && (
                <div>
                  <p className="text-xs text-muted-foreground m-0">{t('rating.certifiedAt')}</p>
                  <p className="font-medium m-0">{formatDate(playerRatingData.certified_at)}</p>
                </div>
              )}
              {playerRatingData.expires_at && (
                <div>
                  <p className="text-xs text-muted-foreground m-0">{t('rating.expiresAt')}</p>
                  <p className="font-medium m-0">{formatDate(playerRatingData.expires_at)}</p>
                </div>
              )}
              {playerRatingData.level_changed_at && (
                <div>
                  <p className="text-xs text-muted-foreground m-0">{t('rating.levelChangedAt')}</p>
                  <p className="font-medium m-0">{formatDate(playerRatingData.level_changed_at)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground m-0">{t('rating.assignedAt')}</p>
                <p className="font-medium m-0">{formatDate(playerRatingData.assigned_at)}</p>
              </div>
            </div>

            {/* Admin notes */}
            {playerRatingData.notes && (
              <div className="bg-muted/20 rounded-lg p-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0 mb-1">
                  {t('rating.adminNotes')}
                </p>
                <p className="text-sm m-0">{playerRatingData.notes}</p>
              </div>
            )}

            {/* Rating Proofs */}
            {ratingProofs.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-semibold m-0 mb-3">{t('rating.proofs')}</p>
                  <div className="space-y-3">
                    {ratingProofs.map(proof => (
                      <div key={proof.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge
                                variant={
                                  proof.status === 'approved'
                                    ? 'default'
                                    : proof.status === 'rejected'
                                      ? 'destructive'
                                      : 'secondary'
                                }
                                className="text-xs"
                              >
                                {t(`rating.proofStatuses.${proof.status}`)}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {t(`rating.proofTypes.${proof.proof_type}`)}
                              </Badge>
                              {proof.rating_score && (
                                <Badge variant="outline" className="text-xs">
                                  {proof.rating_score.label}
                                </Badge>
                              )}
                            </div>
                            <p className="font-medium text-sm m-0 mt-1">{proof.title}</p>
                            {proof.description && (
                              <p className="text-sm text-muted-foreground m-0 mt-1">
                                {proof.description}
                              </p>
                            )}
                            {proof.external_url && (
                              <a
                                href={proof.external_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-primary hover:underline"
                              >
                                {proof.external_url.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                            {proof.review_notes && (
                              <p className="text-xs text-muted-foreground m-0 mt-2">
                                {t('rating.reviewNotes')}: {proof.review_notes}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(proof.created_at)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Rating References */}
            {ratingReferences.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-semibold m-0 mb-3">{t('rating.references')}</p>
                  <div className="space-y-3">
                    {ratingReferences.map(ref => (
                      <div key={ref.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge
                                variant={
                                  ref.status === 'completed'
                                    ? ref.rating_supported
                                      ? 'default'
                                      : 'destructive'
                                    : 'secondary'
                                }
                                className="text-xs"
                              >
                                {t(`rating.refStatuses.${ref.status}`)}
                              </Badge>
                              {ref.status === 'completed' && (
                                <Badge
                                  variant={ref.rating_supported ? 'default' : 'destructive'}
                                  className="text-xs"
                                >
                                  {ref.rating_supported
                                    ? t('rating.supported')
                                    : t('rating.notSupported')}
                                </Badge>
                              )}
                              {ref.rating_score && (
                                <Badge variant="outline" className="text-xs">
                                  {ref.rating_score.label}
                                </Badge>
                              )}
                            </div>
                            {ref.referee && (
                              <p className="text-sm m-0 mt-1">
                                {[ref.referee.first_name, ref.referee.last_name]
                                  .filter(Boolean)
                                  .join(' ')}
                              </p>
                            )}
                            {ref.response_message && (
                              <p className="text-sm text-muted-foreground m-0 mt-1">
                                {ref.response_message}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(ref.created_at)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Match Activity Section */}
      {isPlayer && matchStats.total > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              {t('sections.matchActivity')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard label={t('matchActivity.totalMatches')} value={matchStats.total} />
              <StatCard label={t('matchActivity.played')} value={matchStats.played} />
              <StatCard
                label={t('matchActivity.noShows')}
                value={matchStats.noShows}
                variant={matchStats.noShows > 0 ? 'destructive' : undefined}
              />
              <StatCard
                label={t('matchActivity.lateArrivals')}
                value={matchStats.lateArrivals}
                variant={matchStats.lateArrivals > 0 ? 'warning' : undefined}
              />
              <StatCard label={t('matchActivity.cancellations')} value={matchStats.cancellations} />
              <StatCard
                label={t('matchActivity.avgRating')}
                value={matchStats.avgStarRating != null ? `${matchStats.avgStarRating} / 5` : '-'}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Match Feedback Received Section */}
      {isPlayer && matchFeedbackReceived.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{t('sections.matchFeedback')}</CardTitle>
              <Badge variant="secondary">{matchFeedbackReceived.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {matchFeedbackReceived.map(mf => (
                <div key={mf.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge
                          variant={mf.showed_up ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {mf.showed_up ? t('matchFeedback.showedUp') : t('matchFeedback.noShow')}
                        </Badge>
                        {mf.showed_up && mf.was_late != null && (
                          <Badge
                            variant={mf.was_late ? 'secondary' : 'outline'}
                            className="text-xs"
                          >
                            {mf.was_late ? t('matchFeedback.late') : t('matchFeedback.onTime')}
                          </Badge>
                        )}
                        {mf.star_rating != null && (
                          <span className="text-sm flex items-center gap-1">
                            <Star className="h-3 w-3 fill-current text-yellow-500" />
                            {mf.star_rating}/5
                          </span>
                        )}
                      </div>
                      {mf.comments && (
                        <p className="text-sm text-muted-foreground m-0 mt-1">{mf.comments}</p>
                      )}
                      {mf.reviewer && (
                        <p className="text-xs text-muted-foreground m-0 mt-1">
                          —{' '}
                          {[mf.reviewer.first_name, mf.reviewer.last_name]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(mf.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reports About Player Section */}
      {isPlayer && reportsAbout.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {t('sections.reports')}
              </CardTitle>
              <Badge variant="destructive">{reportsAbout.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {reportsAbout.map(report => (
                <div key={report.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {t(`report.reportTypes.${report.report_type}`)}
                        </Badge>
                        <Badge
                          variant={
                            report.status === 'action_taken'
                              ? 'destructive'
                              : report.status === 'pending'
                                ? 'default'
                                : 'secondary'
                          }
                          className="text-xs"
                        >
                          {t(`report.reportStatuses.${report.status}`)}
                        </Badge>
                        {report.priority && report.priority !== 'normal' && (
                          <Badge
                            variant={
                              report.priority === 'urgent' || report.priority === 'high'
                                ? 'destructive'
                                : 'outline'
                            }
                            className="text-xs"
                          >
                            {capitalize(report.priority)}
                          </Badge>
                        )}
                      </div>
                      {report.description && (
                        <p className="text-sm m-0 mt-1">{report.description}</p>
                      )}
                      {report.action_taken && (
                        <p className="text-sm text-muted-foreground m-0 mt-1">
                          {t('report.actionTaken')}: {report.action_taken}
                        </p>
                      )}
                      {report.reporter && (
                        <p className="text-xs text-muted-foreground m-0 mt-1">
                          —{' '}
                          {[report.reporter.first_name, report.reporter.last_name]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(report.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feedback Section */}
      {isPlayer && (
        <AdminUserFeedbackSection feedback={feedback} sectionTitle={t('sections.feedback')} />
      )}

      {/* Ban History Section */}
      {isPlayer && bans.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">{t('sections.banHistory')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {bans.map(ban => (
                <div key={ban.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={ban.is_active ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {ban.is_active ? t('ban.active') : t('ban.lifted')}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {ban.ban_type === 'permanent' ? t('ban.permanent') : t('ban.temporary')}
                        </Badge>
                      </div>
                      <p className="font-medium text-sm m-0 mt-1">{ban.reason}</p>
                      {ban.notes && (
                        <p className="text-sm text-muted-foreground m-0 mt-1">{ban.notes}</p>
                      )}
                      {ban.lift_reason && (
                        <p className="text-sm text-muted-foreground m-0 mt-1">
                          {t('ban.liftReason')}: {ban.lift_reason}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground space-y-1">
                      <p className="m-0">
                        {t('ban.bannedAt')}: {formatDate(ban.banned_at)}
                      </p>
                      {ban.expires_at && (
                        <p className="m-0">
                          {t('ban.expiresAt')}: {formatDate(ban.expires_at)}
                        </p>
                      )}
                      {ban.lifted_at && (
                        <p className="m-0">
                          {t('ban.liftedAt')}: {formatDate(ban.lifted_at)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Organization Memberships Section */}
      {orgMemberships && orgMemberships.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">{t('sections.organizations')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {orgMemberships.map(membership => {
                const org = membership.organization as unknown as {
                  name: string;
                  slug: string;
                } | null;
                return (
                  <div
                    key={membership.id}
                    className="flex items-center justify-between border rounded-lg p-4"
                  >
                    <div>
                      <p className="font-medium text-sm m-0">{org?.name ?? '-'}</p>
                      <p className="text-xs text-muted-foreground m-0 mt-1">
                        {t('organization.role')}: {capitalize(membership.role)}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t('organization.joinedAt')}: {formatDate(membership.joined_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settings & Preferences Section */}
      {isPlayer && playerData && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30 border-b">
            <CardTitle className="text-lg">{t('sections.settings')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            {/* Privacy Settings */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0 mb-3">
                {t('settings.privacy')}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SettingToggle
                  label={t('settings.showAge')}
                  enabled={playerData.privacy_show_age}
                  t={t}
                />
                <SettingToggle
                  label={t('settings.showLocation')}
                  enabled={playerData.privacy_show_location}
                  t={t}
                />
                <SettingToggle
                  label={t('settings.showAvailability')}
                  enabled={playerData.privacy_show_availability}
                  t={t}
                />
                <SettingToggle
                  label={t('settings.showStats')}
                  enabled={playerData.privacy_show_stats}
                  t={t}
                />
              </div>
            </div>

            <Separator />

            {/* Notification Settings */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0 mb-3">
                {t('settings.notifications')}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SettingToggle
                  label={t('settings.matchRequests')}
                  enabled={playerData.notification_match_requests}
                  t={t}
                />
                <SettingToggle
                  label={t('settings.messages')}
                  enabled={playerData.notification_messages}
                  t={t}
                />
                <SettingToggle
                  label={t('settings.reminders')}
                  enabled={playerData.notification_reminders}
                  t={t}
                />
                <SettingToggle
                  label={t('settings.pushEnabled')}
                  enabled={playerData.push_notifications_enabled}
                  t={t}
                />
              </div>
            </div>

            <Separator />

            {/* Other Settings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              {profile.preferred_locale && (
                <div>
                  <p className="text-xs text-muted-foreground m-0">{t('settings.locale')}</p>
                  <p className="font-medium m-0">{profile.preferred_locale}</p>
                </div>
              )}
              {profile.referral_code && (
                <div>
                  <p className="text-xs text-muted-foreground m-0">{t('settings.referralCode')}</p>
                  <p className="font-medium m-0 font-mono">{profile.referral_code}</p>
                </div>
              )}
              {playerData.chat_rules_agreed_at && (
                <div>
                  <p className="text-xs text-muted-foreground m-0">
                    {t('settings.chatRulesAgreed')}
                  </p>
                  <p className="font-medium m-0">{formatDate(playerData.chat_rules_agreed_at)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="p-2 bg-primary/10 rounded-md">{icon}</div>
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide m-0">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | string;
  variant?: 'destructive' | 'warning';
}) {
  return (
    <div className="text-center p-3 bg-muted/20 rounded-lg">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 mt-0">
        {label}
      </p>
      <p
        className={`text-lg font-semibold m-0 ${
          variant === 'destructive'
            ? 'text-destructive'
            : variant === 'warning'
              ? 'text-yellow-600'
              : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SettingToggle({
  label,
  enabled,
  t,
}: {
  label: string;
  enabled: boolean | null;
  t: (key: string) => string;
}) {
  const isEnabled = enabled ?? true;
  return (
    <div className="flex items-center justify-between border rounded-lg p-3">
      <span className="text-sm">{label}</span>
      <Badge variant={isEnabled ? 'default' : 'secondary'} className="text-xs">
        {isEnabled ? t('settings.enabled') : t('settings.disabled')}
      </Badge>
    </div>
  );
}
