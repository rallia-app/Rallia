import { buildEraseMetadata, ErasePage } from '@/components/ErasePage';

export const metadata = buildEraseMetadata('fr-CA');

export default function Page() {
  return <ErasePage locale="fr-CA" />;
}
