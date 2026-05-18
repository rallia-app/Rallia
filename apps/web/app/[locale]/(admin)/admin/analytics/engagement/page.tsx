import { MatchStatsSection } from '@/components/admin/match-stats-section';
import { SportStatsSection } from '@/components/admin/sport-stats-section';

export default function AdminAnalyticsEngagementPage() {
  return (
    <div className="flex flex-col gap-4">
      <MatchStatsSection />
      <SportStatsSection />
    </div>
  );
}
