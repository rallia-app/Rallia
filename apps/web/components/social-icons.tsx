import { Facebook, Instagram, Linkedin } from 'lucide-react';
import { cn } from '@/lib/utils';

// Edit these to point to your actual Rallia social accounts. They're
// placeholders right now — keeping them in one constant means a single
// edit propagates to the footer and the mobile nav sheet.
export const SOCIAL_LINKS = {
  instagram: 'https://www.instagram.com/rallia.app',
  facebook: 'https://www.facebook.com/profile.php?id=61574248480253',
  tiktok: 'https://www.tiktok.com/@rallia.app',
  linkedin: 'https://www.linkedin.com/company/rallia',
} as const;

// lucide-react doesn't ship a TikTok glyph; this is the official monochrome mark.
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.61a8.27 8.27 0 0 0 4.83 1.55v-3.4a4.83 4.83 0 0 1-1.9-.07Z" />
    </svg>
  );
}

const socials = [
  { key: 'instagram', href: SOCIAL_LINKS.instagram, Icon: Instagram, label: 'Instagram' },
  { key: 'facebook', href: SOCIAL_LINKS.facebook, Icon: Facebook, label: 'Facebook' },
  { key: 'tiktok', href: SOCIAL_LINKS.tiktok, Icon: TikTokIcon, label: 'TikTok' },
  { key: 'linkedin', href: SOCIAL_LINKS.linkedin, Icon: Linkedin, label: 'LinkedIn' },
] as const;

export type SocialVariant = 'default' | 'onDark';

export interface SocialIconsProps {
  className?: string;
  iconClassName?: string;
  /**
   * `default` adapts to the site theme. `onDark` forces white-on-dark
   * (use over dark hero overlays, e.g. landing header).
   */
  variant?: SocialVariant;
}

export function SocialIcons({ className, iconClassName, variant = 'default' }: SocialIconsProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {socials.map(({ key, href, Icon, label }) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Follow Rallia on ${label}`}
          className={cn(
            'inline-flex items-center justify-center transition-colors',
            variant === 'onDark'
              ? 'text-white/70 hover:text-white'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className={cn('size-5', iconClassName)} />
        </a>
      ))}
    </div>
  );
}

export default SocialIcons;
