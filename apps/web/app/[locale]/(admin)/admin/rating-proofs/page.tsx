import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.ratingProofs');
  return { title: `${t('title')} - Rallia` };
}

type FlaggedProof = {
  id: string;
  title: string;
  status: string;
  auto_flag_status: string;
  auto_flag_reason: string | null;
  auto_flag_confidence: number | null;
  auto_flag_media_kind: string | null;
  auto_flagged_at: string | null;
  created_at: string;
  player_rating_score: { player_id: string } | null;
  rating_score: { label: string } | null;
};

export default async function AdminRatingProofsPage() {
  await requireAdminRole(['super_admin', 'moderator']);
  const t = await getTranslations('admin.ratingProofs');
  const adminDb = createServiceRoleClient();

  const { data } = await adminDb
    .from('rating_proof')
    .select(
      `
      id, title, status, auto_flag_status, auto_flag_reason, auto_flag_confidence,
      auto_flag_media_kind, auto_flagged_at, created_at,
      player_rating_score:player_rating_score_id ( player_id ),
      rating_score:rating_score_id ( label )
      `
    )
    .in('auto_flag_status', ['implausible', 'error'])
    .eq('is_active', true)
    .order('auto_flagged_at', { ascending: false, nullsFirst: false })
    .limit(200);

  const proofs = (data ?? []) as unknown as FlaggedProof[];

  // Resolve player display names in one batch.
  const playerIds = Array.from(
    new Set(proofs.map(p => p.player_rating_score?.player_id).filter((v): v is string => !!v))
  );
  const namesById = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data: profiles } = await adminDb
      .from('profile')
      .select('id, first_name, last_name')
      .in('id', playerIds);
    for (const p of profiles ?? []) {
      namesById.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.id);
    }
  }

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {proofs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proofs.map(proof => {
            const playerId = proof.player_rating_score?.player_id ?? null;
            const playerName = playerId
              ? (namesById.get(playerId) ?? playerId)
              : t('unknownPlayer');
            return (
              <Card key={proof.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge
                          variant={
                            proof.auto_flag_status === 'implausible' ? 'destructive' : 'outline'
                          }
                          className="text-xs"
                        >
                          {t(`flagStatus.${proof.auto_flag_status}`)}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {t(`proofStatus.${proof.status}`)}
                        </Badge>
                        {proof.rating_score && (
                          <Badge variant="outline" className="text-xs">
                            {proof.rating_score.label}
                          </Badge>
                        )}
                        {proof.auto_flag_media_kind && (
                          <Badge variant="outline" className="text-xs">
                            {proof.auto_flag_media_kind}
                          </Badge>
                        )}
                      </div>
                      <p className="font-medium text-sm m-0 mt-1">{proof.title}</p>
                      {proof.auto_flag_reason && (
                        <p className="text-sm text-muted-foreground m-0 mt-1">
                          {proof.auto_flag_reason}
                          {proof.auto_flag_confidence != null &&
                            ` (${Math.round(proof.auto_flag_confidence * 100)}%)`}
                        </p>
                      )}
                      {playerId && (
                        <Link
                          href={`/admin/users/${playerId}`}
                          className="text-sm text-primary hover:underline"
                        >
                          {playerName}
                        </Link>
                      )}
                    </div>
                    {proof.auto_flagged_at && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(proof.auto_flagged_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
