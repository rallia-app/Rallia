import LandingNav from './landing-nav';
import LocaleToggle from './locale-toggle';
import ModeToggle from './mode-toggle';
import ThemeLogo from './theme-logo';

export function LandingHeader() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/40 to-transparent pointer-events-none">
      <div className="pointer-events-auto">
        <header className="flex w-full max-w-6xl mx-auto my-8 justify-between items-center gap-3 px-8">
          <ThemeLogo href="/" width={120} height={40} variant="light" />
          <LandingNav />
          {/* Desktop-only controls; on mobile these live inside the nav panel.
              Forced white because they sit over the dark hero video. */}
          <div className="hidden md:flex items-center gap-3 [&_button]:!text-white [&_button]:hover:!bg-white/10">
            <LocaleToggle />
            <ModeToggle />
          </div>
        </header>
      </div>
    </div>
  );
}
