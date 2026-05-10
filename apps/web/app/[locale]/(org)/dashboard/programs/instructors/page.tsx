import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { BackButton } from '@/components/back-button';
import { createClient } from '@/lib/supabase/server';
import { getSelectedOrganization } from '@/lib/supabase/get-selected-organization';
import { GraduationCap, Mail, Phone, Plus, UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getStorageImageUrl } from '@rallia/shared-utils';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Instructors - Rallia',
    description: 'Manage your program instructors and coaches.',
  };
}

export default async function InstructorsPage() {
  const t = await getTranslations('programs.instructors');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const organization = await getSelectedOrganization(user!.id);

  // Fetch instructors
  let instructors: Array<{
    id: string;
    display_name: string;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
    is_external: boolean;
    is_active: boolean;
    hourly_rate_cents: number | null;
    currency: string | null;
    specializations: string[] | null;
    programs_count?: number;
  }> = [];

  if (organization) {
    const { data } = await supabase
      .from('instructor_profile')
      .select('*')
      .eq('organization_id', organization.id)
      .order('display_name', { ascending: true });

    instructors = (data || []).map(d => ({
      ...d,
      specializations: Array.isArray(d.specializations) ? (d.specializations as string[]) : null,
    }));

    // Get program counts for each instructor
    if (instructors.length > 0) {
      const instructorIds = instructors.map(i => i.id);
      const { data: programCounts } = await supabase
        .from('program_instructor')
        .select('instructor_id, program:program_id(status)')
        .in('instructor_id', instructorIds);

      const countByInstructor =
        programCounts?.reduce(
          (acc, pi) => {
            const program = pi.program as { status: string } | null;
            if (program && ['draft', 'published'].includes(program.status)) {
              acc[pi.instructor_id] = (acc[pi.instructor_id] || 0) + 1;
            }
            return acc;
          },
          {} as Record<string, number>
        ) || {};

      instructors = instructors.map(i => ({
        ...i,
        programs_count: countByInstructor[i.id] || 0,
      }));
    }
  }

  const activeInstructors = instructors.filter(i => i.is_active);
  const externalInstructors = instructors.filter(i => i.is_external);

  return (
    <div className="flex flex-col w-full gap-8">
      <div className="flex items-center justify-between">
        <div>
          <BackButton className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
            {t('backToPrograms')}
          </BackButton>
          <h1 className="text-3xl font-bold mb-0">{t('title')}</h1>
          <p className="text-muted-foreground mb-0">{t('description')}</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/programs/instructors/new">
            <Plus className="mr-2 size-4" />
            {t('addInstructor')}
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-0">{t('stats.total')}</p>
                <p className="text-3xl font-bold mb-0">{instructors.length}</p>
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
                <p className="text-sm font-medium text-muted-foreground mb-0">
                  {t('stats.active')}
                </p>
                <p className="text-3xl font-bold mb-0">{activeInstructors.length}</p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg">
                <GraduationCap className="size-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-0">
                  {t('stats.external')}
                </p>
                <p className="text-3xl font-bold mb-0">{externalInstructors.length}</p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <UserPlus className="size-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instructors List */}
      {instructors.length === 0 ? (
        <Card className="p-12 text-center">
          <GraduationCap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-semibold mb-2">{t('empty.noInstructors')}</h3>
          <p className="text-muted-foreground mb-4">{t('empty.addFirst')}</p>
          <Button asChild>
            <Link href="/dashboard/programs/instructors/new">
              <Plus className="mr-2 size-4" />
              {t('empty.addInstructor')}
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {instructors.map(instructor => (
            <Link
              key={instructor.id}
              href={`/dashboard/programs/instructors/${instructor.id}`}
              className="block"
            >
              <Card className="hover:border-primary/50 hover:shadow-md transition-all h-full">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      {instructor.avatar_url ? (
                        <img
                          src={
                            getStorageImageUrl(instructor.avatar_url, {
                              width: 96,
                              height: 96,
                              quality: 70,
                            }) ?? ''
                          }
                          alt={instructor.display_name}
                          className="size-12 rounded-full object-cover"
                        />
                      ) : (
                        <GraduationCap className="size-6 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate mb-0">{instructor.display_name}</h3>
                        {!instructor.is_active && (
                          <Badge variant="secondary">{t('badges.inactive')}</Badge>
                        )}
                        {instructor.is_external && (
                          <Badge variant="outline">{t('badges.external')}</Badge>
                        )}
                      </div>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {instructor.email && (
                          <p className="flex items-center gap-1 truncate">
                            <Mail className="size-3" />
                            {instructor.email}
                          </p>
                        )}
                        {instructor.phone && (
                          <p className="flex items-center gap-1">
                            <Phone className="size-3" />
                            {instructor.phone}
                          </p>
                        )}
                        <p className="flex items-center gap-1">
                          <GraduationCap className="size-3" />
                          {instructor.programs_count || 0} {t('activePrograms')}
                        </p>
                      </div>
                      {instructor.specializations && instructor.specializations.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {instructor.specializations.slice(0, 3).map((spec, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {spec}
                            </Badge>
                          ))}
                        </div>
                      )}
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
