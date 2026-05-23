import { notFound } from 'next/navigation';

// Catch-all under [locale] so unmatched routes render the localized
// not-found.tsx instead of Next.js's default 404 page.
export default function CatchAllNotFound() {
  notFound();
}
