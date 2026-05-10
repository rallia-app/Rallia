import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSelectedOrganization } from '@/lib/supabase/get-selected-organization';
import { BackButton } from '@/components/back-button';
import { Calendar, Edit, GraduationCap, Mail, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getStorageImageUrl } from '@rallia/shared-utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('programs.instructors.detail');
  return {
    title: t('title'),
    description: t('description'),
  };
}

function formatPrice(cents: number, currency: string = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

export default async function InstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations('programs.instructors');
  const tPrograms = await getTranslations('programs');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const organization = await getSelectedOrganization(user!.id);

  // Fetch instructor
  const { data: instructor, error } = await supabase
    .from('instructor_profile')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !instructor) {
    notFound();
  }

  // Verify organization access
  if (instructor.organization_id !== organization?.id) {
    notFound();
  }

  // Get assigned programs
  const { data: programAssignments } = await supabase
    .from('program_instructor')
    .select(
      `
      is_primary,
      program:program_id (
        id,
        name,
        status,
        start_date,
        type
      )
    `
    )
    .eq('instructor_id', id);

  const programs =
    programAssignments
      ?.map(pa => ({
        ...(pa.program as {
          id: string;
          name: string;
          status: string;
          start_date: string;
          type: string;
        }),
        is_primary: pa.is_primary,
      }))
      .filter(Boolean) || [];

  const activePrograms = programs.filter(p => p.status === 'published' || p.status === 'draft');

  return (
    <div className="flex flex-col w-full gap-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <BackButton className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
            {t('backToPrograms')}
          </BackButton>
          <div className="flex items-center gap-4">
            <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center">
              {instructor.avatar_url ? (
                <img
                  src={
                    getStorageImageUrl(instructor.avatar_url, {
                      width: 200,
                      height: 200,
                      quality: 75,
                    }) ?? ''
                  }
                  alt={instructor.display_name}
                  className="size-16 rounded-full object-cover"
                />
              ) : (
                <GraduationCap className="size-8 text-primary" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-3xl font-bold mb-0">{instructor.display_name}</h1>
                {!instructor.is_active && <Badge variant="secondary">{t('badges.inactive')}</Badge>}
                {instructor.is_external && <Badge variant="outline">{t('badges.external')}</Badge>}
              </div>
              {instructor.bio && <p className="text-muted-foreground max-w-xl">{instructor.bio}</p>}
            </div>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/dashboard/programs/instructors/${id}/edit`}>
            <Edit className="mr-2 size-4" />
            {tPrograms('detail.edit')}
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.contactInformation')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {instructor.email && (
              <div className="flex items-center gap-3">
                <Mail className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground mb-0">{t('new.fields.email')}</p>
                  <p className="font-medium mb-0">{instructor.email}</p>
                </div>
              </div>
            )}
            {instructor.phone && (
              <div className="flex items-center gap-3">
                <Phone className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground mb-0">{t('new.fields.phone')}</p>
                  <p className="font-medium mb-0">{instructor.phone}</p>
                </div>
              </div>
            )}
            {!instructor.email && !instructor.phone && (
              <p className="text-muted-foreground text-sm">{t('detail.noContactInformation')}</p>
            )}
          </CardContent>
        </Card>

        {/* Rate & Specializations */}
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.details')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {instructor.hourly_rate_cents && (
              <div>
                <p className="text-sm text-muted-foreground mb-0">{t('new.fields.hourlyRate')}</p>
                <p className="text-2xl font-bold mb-0">
                  {formatPrice(instructor.hourly_rate_cents, instructor.currency || 'CAD')}
                  <span className="text-sm font-normal text-muted-foreground">
                    {t('detail.hourlyRateSuffix')}
                  </span>
                </p>
              </div>
            )}
            {instructor.specializations &&
              Array.isArray(instructor.specializations) &&
              instructor.specializations.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {t('new.fields.specializations')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(instructor.specializations as string[]).map((spec: string, i: number) => (
                      <Badge key={i} variant="secondary">
                        {spec}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
          </CardContent>
        </Card>
      </div>

      {/* Assigned Programs */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.assignedPrograms')}</CardTitle>
          <CardDescription>
            {activePrograms.length} {t('activePrograms')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {programs.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">
              {t('detail.notAssigned')}
            </p>
          ) : (
            <div className="space-y-3">
              {programs.map(program => (
                <Link
                  key={program.id}
                  href={`/dashboard/programs/${program.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="size-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{program.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(program.start_date + 'T00:00:00').toLocaleDateString('en-CA', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {program.is_primary && (
                      <Badge variant="default">{tPrograms('detail.leadInstructor')}</Badge>
                    )}
                    <Badge variant={program.status === 'published' ? 'default' : 'secondary'}>
                      {tPrograms(`status.${program.status}`)}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
