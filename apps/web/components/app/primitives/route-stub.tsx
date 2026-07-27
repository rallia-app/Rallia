import { Construction } from 'lucide-react';

import { EmptyState } from './empty-state';

/**
 * Placeholder for a player route whose screen has not been built yet.
 *
 * The whole URL map ships in phase 0 so navigation, the guard and the shell can be
 * exercised end to end before any feature lands. Each stub names the phase that
 * replaces it, so an unfinished route is never mistaken for a broken one.
 */
export function RouteStub({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">{title}</h1>
      <EmptyState
        icon={Construction}
        title="Not built yet"
        description={`This screen arrives in ${phase}. The route, the shell and the auth guard around it are already live.`}
      />
    </div>
  );
}
