import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSelectedOrganization } from '@/lib/supabase/get-selected-organization';
import { Calendar, Clock, DollarSign, GraduationCap, Plus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Programs & Lessons - Rallia',
    description: 'Manage your programs, clinics, camps, and lessons.',
  };
}

function formatPrice(cents: number, currency: string = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function formatDate(dateString: string): string {
  // Append T00:00:00 to parse as local date, not UTC
  return new Date(dateString + 'T00:00:00').toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getStatusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'published':
      return 'default';
    case 'draft':
      return 'secondary';
    case 'cancelled':
      return 'destructive';
    case 'completed':
      return 'outline';
    default:
      return 'secondary';
  }
}

export default async function ProgramsPage() {
  const t = await getTranslations('programs');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const organization = await getSelectedOrganization(user.id);

  // Fetch programs
  let programs: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    start_date: string;
    end_date: string | null;
    price_cents: number;
    currency: string;
    current_participants: number;
    max_participants: number | null;
    sessions_count?: number;
  }> = [];

  if (organization) {
    const { data } = await supabase
      .from('program')
      .select(
        `
        id,
        name,
        type,
        status,
        start_date,
        end_date,
        price_cents,
        currency,
        current_participants,
        max_participants
      `
      )
      .eq('organization_id', organization.id)
      .order('start_date', { ascending: false })
      .limit(20);

    programs = data || [];

    // Get session counts for each program
    if (programs.length > 0) {
      const programIds = programs.map(p => p.id);
      const { data: sessionCounts } = await supabase
        .from('program_session')
        .select('program_id')
        .in('program_id', programIds)
        .eq('is_cancelled', false);

      const countByProgram =
        sessionCounts?.reduce(
          (acc, s) => {
            acc[s.program_id] = (acc[s.program_id] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ) || {};

      programs = programs.map(p => ({
        ...p,
        sessions_count: countByProgram[p.id] || 0,
      }));
    }
  }

  return (
    <div className="flex flex-col w-full gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-0">{t('title')}</h1>
          <p className="text-muted-foreground mb-0">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/programs/instructors">
              <GraduationCap className="mr-2 size-4" />
              {t('instructors.title')}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/programs/new">
              <Plus className="mr-2 size-4" />
              {t('newProgram')}
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('stats.totalPrograms')}
                </p>
                <p className="text-3xl font-bold mb-1">{programs.length}</p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <GraduationCap className="size-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('stats.active')}
                </p>
                <p className="text-3xl font-bold mb-1">
                  {programs.filter(p => p.status === 'published').length}
                </p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg">
                <Calendar className="size-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('stats.totalParticipants')}
                </p>
                <p className="text-3xl font-bold mb-1">
                  {programs.reduce((sum, p) => sum + p.current_participants, 0)}
                </p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <Users className="size-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('stats.drafts')}
                </p>
                <p className="text-3xl font-bold mb-1">
                  {programs.filter(p => p.status === 'draft').length}
                </p>
              </div>
              <div className="p-3 bg-orange-500/10 rounded-lg">
                <Clock className="size-6 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Programs List */}
      {programs.length === 0 ? (
        <Card className="p-12 text-center">
          <GraduationCap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">{t('empty.noPrograms')}</h3>
          <p className="text-muted-foreground mb-4">{t('empty.createFirst')}</p>
          <Button asChild>
            <Link href="/dashboard/programs/new">
              <Plus className="mr-2 size-4" />
              {t('empty.createProgram')}
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {programs.map(program => (
            <Link key={program.id} href={`/dashboard/programs/${program.id}`} className="block">
              <Card className="hover:border-primary/50 hover:shadow-md transition-all">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold truncate mb-0">{program.name}</h3>
                        <Badge variant={getStatusBadgeVariant(program.status)}>
                          {t(`status.${program.status}`)}
                        </Badge>
                        <Badge variant="outline" className="capitalize">
                          {t(`type.${program.type}`)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="size-4" />
                          {formatDate(program.start_date)}
                          {program.end_date && ` - ${formatDate(program.end_date)}`}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-4" />
                          {program.sessions_count || 0} {t('stats.sessions')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="size-4" />
                          {program.current_participants}
                          {program.max_participants && ` / ${program.max_participants}`}
                        </span>
                        <span className="flex items-center gap-1">
                          <DollarSign className="size-4" />
                          {formatPrice(program.price_cents, program.currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
