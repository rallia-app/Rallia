'use client';

import { Link } from '@/i18n/navigation';
import LogoDark from '@/public/rallia_logo_dark.svg';
import LogoLight from '@/public/rallia_logo_light.svg';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import { useEffect, useState } from 'react';

interface ThemeLogoProps {
  width?: number;
  height?: number;
  className?: string;
  href?: string;
  variant?: 'auto' | 'light' | 'dark';
}

export default function ThemeLogo({
  width = 120,
  height = 40,
  className = '',
  href,
  variant = 'auto',
}: ThemeLogoProps) {
  const [mounted, setMounted] = useState(false);
  const { theme, systemTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent rendering until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <div style={{ width, height }} className={className}>
        {/* Placeholder to maintain layout */}
      </div>
    );
  }

  const currentTheme = theme === 'system' ? systemTheme : theme;
  const logoSrc =
    variant === 'light'
      ? LogoLight
      : variant === 'dark'
        ? LogoDark
        : currentTheme === 'dark'
          ? LogoLight
          : LogoDark;

  const logoElement = (
    <Image
      src={logoSrc}
      alt="Rallia Logo"
      width={width}
      height={height}
      priority
      className={className}
    />
  );

  if (href) {
    return <Link href={href}>{logoElement}</Link>;
  }

  return <div>{logoElement}</div>;
}
