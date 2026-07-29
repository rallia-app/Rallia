import { buildFunnelMetadata, FunnelPage } from '@/components/FunnelPage';

export const metadata = buildFunnelMetadata('fr-CA');

export default function Page() {
  return <FunnelPage locale="fr-CA" />;
}
