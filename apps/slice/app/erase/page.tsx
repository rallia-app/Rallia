import { buildEraseMetadata, ErasePage } from '@/components/ErasePage';

export const metadata = buildEraseMetadata('en-US');

export default function Page() {
  return <ErasePage locale="en-US" />;
}
