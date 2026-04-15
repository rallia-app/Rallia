import LandingNav from './landing-nav';
import LocaleToggle from './locale-toggle';
import ModeToggle from './mode-toggle';
import ThemeLogo from './theme-logo';

export function LandingHeader() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/40 to-transparent pointer-events-none">
      <div className="pointer-events-auto">
        <header className="flex w-full max-w-6xl mx-auto my-8 justify-between items-center gap-3 px-8 [&_a]:text-white [&_button]:text-white">
          <ThemeLogo href="/" width={120} height={40} variant="light" />
          <LandingNav />
          <div className="flex items-center gap-3">
            <LocaleToggle />
            <ModeToggle />
          </div>
        </header>
      </div>
    </div>
  );
}
