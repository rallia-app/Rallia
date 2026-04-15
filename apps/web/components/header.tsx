import HeaderNav from './header-nav';
import LocaleToggle from './locale-toggle';
import ModeToggle from './mode-toggle';
import ThemeLogo from './theme-logo';

export default function Header() {
  return (
    <header className="flex w-full max-w-6xl mx-auto my-8 justify-between items-center gap-3 px-8">
      <ThemeLogo href="/" width={120} height={40} />
      <HeaderNav />
      <div className="flex items-center gap-3">
        <LocaleToggle />
        <ModeToggle />
      </div>
    </header>
  );
}
