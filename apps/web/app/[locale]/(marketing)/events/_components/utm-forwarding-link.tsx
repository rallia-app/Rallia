'use client';

import { useEffect, useState } from 'react';

import { Link } from '@/i18n/navigation';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

interface UtmForwardingLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

/** Statically rendered link that appends the landing URL's utm_* params after
 *  hydration. The page is ISR-cached so the server never sees the query
 *  string, and the rallia_utm cookie only exists after analytics consent —
 *  forwarding through the URL is the only consent-free way to carry campaign
 *  attribution into the invite page (where URL UTMs win over the cookie). */
export function UtmForwardingLink({ href, className, children }: UtmForwardingLinkProps) {
  const [finalHref, setFinalHref] = useState(href);

  useEffect(() => {
    const current = new URLSearchParams(window.location.search);
    const forwarded = new URLSearchParams();
    for (const key of UTM_KEYS) {
      const value = current.get(key);
      if (value) forwarded.set(key, value);
    }
    const qs = forwarded.toString();
    if (qs) setFinalHref(`${href}${href.includes('?') ? '&' : '?'}${qs}`);
  }, [href]);

  return (
    <Link href={finalHref} className={className}>
      {children}
    </Link>
  );
}
