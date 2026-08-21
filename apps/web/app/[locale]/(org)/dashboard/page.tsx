import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSelectedOrganization } from '@/lib/supabase/get-selected-organization';
import {
  ArrowRight,
  Calendar,
  CalendarCheck,
  Clock,
  DollarSign,
  MapPin,
  Plus,
  Settings,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

// Helper to get today's date in YYYY-MM-DD format
function getTodayDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to get start of week (Monday)
function getWeekStartDate(): string {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today.setDate(diff));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

// Helper to format time
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Dashboard - Rallia',
    description: 'Your organization dashboard on Rallia.',
  };
}

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const supabase = await createClient();

  // Get authenticated user (auth check is done in layout)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user profile (currently unused but may be needed for future features)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: profile } = await supabase.from('profile').select('*').eq('id', user!.id).single();

  // Get the selected organization (respects user's selection from org switcher)
  const organization = await getSelectedOrganization(user!.id);

  // Fetch KPI data if organization exists
  let todaysBookingsCount = 0;
  let weekRevenue = 0;
  let utilizationRate = 0;
  let pendingActionsCount = 0;
  let todaysBookings: Array<{
    id: string;
    start_time: string;
    end_time: string;
    notes: string | null;
    court: { name: string | null; court_number: number | null } | null;
  }> = [];

  if (organization) {
    const todayStr = getTodayDateString();
    const weekStartStr = getWeekStartDate();

    // First get facility IDs for this organization
    const { data: facilities } = await supabase
      .from('facility')
      .select('id')
      .eq('organization_id', organization.id)
      .is('archived_at', null);

    const facilityIds = facilities?.map(f => f.id) || [];

    if (facilityIds.length > 0) {
      // Get court IDs for these facilities
      const { data: courts } = await supabase
        .from('court')
        .select('id')
        .in('facility_id', facilityIds)
        .eq('is_active', true);

      const courtIds = courts?.map(c => c.id) || [];

      if (courtIds.length > 0) {
        // Fetch today's bookings count
        const { count: todayCount } = await supabase
          .from('booking')
          .select('*', { count: 'exact', head: true })
          .in('court_id', courtIds)
          .eq('booking_date', todayStr)
          .not('status', 'eq', 'cancelled');

        todaysBookingsCount = todayCount || 0;

        // Fetch today's bookings for schedule widget
        const { data: todayBookingsData } = await supabase
          .from('booking')
          .select(
            `
            id,
            start_time,
            end_time,
            notes,
            court:court_id (
              name,
              court_number
            )
          `
          )
          .in('court_id', courtIds)
          .eq('booking_date', todayStr)
          .not('status', 'eq', 'cancelled')
          .order('start_time', { ascending: true })
          .limit(5);

        todaysBookings = (todayBookingsData || []) as unknown as typeof todaysBookings;

        // Fetch this week's revenue
        const { data: weekBookings } = await supabase
          .from('booking')
          .select('price_cents')
          .in('court_id', courtIds)
          .gte('booking_date', weekStartStr)
          .lte('booking_date', todayStr)
          .in('status', ['confirmed', 'completed']);

        weekRevenue = (weekBookings || []).reduce((sum, b) => sum + (b.price_cents || 0), 0) / 100;

        // Fetch pending actions count (pending or awaiting_approval bookings)
        const { count: pendingCount } = await supabase
          .from('booking')
          .select('*', { count: 'exact', head: true })
          .in('court_id', courtIds)
          .in('status', ['pending', 'awaiting_approval']);

        pendingActionsCount = pendingCount || 0;

        // Calculate utilization for today (simple approximation)
        // Assuming 14 hours of operating time (7am-9pm) and 1-hour slots
        const totalPossibleSlots = courtIds.length * 14; // courts * hours per day
        utilizationRate =
          totalPossibleSlots > 0 ? Math.round((todaysBookingsCount / totalPossibleSlots) * 100) : 0;
      }
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="flex flex-col w-full gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-0">{t('title')}</h1>
          <p className="text-muted-foreground mb-0">{t('description')}</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/bookings/new">
            <Plus className="mr-2 size-4" />
            {t('quickActions.newBooking')}
          </Link>
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('kpi.todaysBookings')}
                </p>
                <p className="text-3xl font-bold mb-1">{todaysBookingsCount}</p>
                <p className="text-xs text-muted-foreground">{t('kpi.todaysBookingsDesc')}</p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <CalendarCheck className="size-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('kpi.weekRevenue')}
                </p>
                <p className="text-3xl font-bold mb-1">{formatCurrency(weekRevenue)}</p>
                <p className="text-xs text-muted-foreground">{t('kpi.weekRevenueDesc')}</p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg">
                <DollarSign className="size-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('kpi.utilization')}
                </p>
                <p className="text-3xl font-bold mb-1">{utilizationRate}%</p>
                <p className="text-xs text-muted-foreground">{t('kpi.utilizationDesc')}</p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-lg">
                <TrendingUp className="size-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {t('kpi.pendingActions')}
                </p>
                <p className="text-3xl font-bold mb-1">{pendingActionsCount}</p>
                <p className="text-xs text-muted-foreground">{t('kpi.pendingActionsDesc')}</p>
              </div>
              <div className="p-3 bg-orange-500/10 rounded-lg">
                <AlertCircle className="size-6 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/dashboard/facilities" className="block group">
          <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                    <MapPin className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold mb-0">{t('quickActions.facilities')}</p>
                    <p className="text-sm text-muted-foreground mb-0">
                      {t('quickActions.facilitiesDesc')}
                    </p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/availability" className="block group">
          <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                    <Calendar className="size-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="font-semibold mb-0">{t('quickActions.availability')}</p>
                    <p className="text-sm text-muted-foreground mb-0">
                      {t('quickActions.availabilityDesc')}
                    </p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/bookings" className="block group">
          <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-green-500/10 rounded-lg group-hover:bg-green-500/20 transition-colors">
                    <CalendarCheck className="size-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-semibold mb-0">{t('quickActions.bookings')}</p>
                    <p className="text-sm text-muted-foreground mb-0">
                      {t('quickActions.bookingsDesc')}
                    </p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-green-500 group-hover:translate-x-1 transition-all" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/settings" className="block group">
          <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-orange-500/10 rounded-lg group-hover:bg-orange-500/20 transition-colors">
                    <Settings className="size-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="font-semibold mb-0">{t('quickActions.settings')}</p>
                    <p className="text-sm text-muted-foreground mb-0">
                      {t('quickActions.settingsDesc')}
                    </p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Today's Schedule */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-md">
                <Clock className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">{t('todaySchedule.title')}</CardTitle>
                <CardDescription>
                  {new Date().toLocaleDateString(locale, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/bookings">
                {t('todaySchedule.viewAll')}
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {todaysBookings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="size-12 mx-auto mb-3 opacity-50" />
              <p>{t('todaySchedule.noBookings')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todaysBookings.map(booking => {
                // Extract guest name from notes if available
                let guestName = t('todaySchedule.guest');
                if (booking.notes) {
                  const guestMatch = booking.notes.match(/Guest:\s*([^|]+)/);
                  if (guestMatch) {
                    guestName = guestMatch[1].trim();
                  }
                }
                return (
                  <Link
                    key={booking.id}
                    href={`/dashboard/bookings/${booking.id}`}
                    className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors group mb-0"
                  >
                    <div className="flex flex-col items-center justify-center bg-primary/10 rounded-lg px-3 py-2 min-w-[70px]">
                      <span className="text-sm font-semibold text-primary">
                        {formatTime(booking.start_time)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(booking.end_time)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate mb-0">
                        {booking.court?.name || `Court ${booking.court?.court_number}`}
                      </p>
                      <p className="text-sm text-muted-foreground truncate mb-0">{guestName}</p>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
