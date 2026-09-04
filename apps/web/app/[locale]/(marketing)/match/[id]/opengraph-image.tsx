import { renderMatchCard } from '@/app/api/og/_shared/match-card';
import { getMatch } from '@/lib/match/get-match';

export const alt = 'Rallia Match';
// Kept as a literal: Next reads the metadata convention's `size` statically.
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

export default async function Image({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  return renderMatchCard(await getMatch(id), locale);
}
