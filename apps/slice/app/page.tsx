import { buildFunnelMetadata, FunnelPage } from '@/components/FunnelPage';

export const metadata = buildFunnelMetadata('en-US');

export default function Page() {
  return <FunnelPage locale="en-US" />;
}
