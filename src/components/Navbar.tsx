import { useEffect, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Logo } from './Logo';
import { GithubIcon } from './icons';

export const GITHUB_URL = 'https://github.com/dotra/dotra';

const LINKS = [
  { href: '#studio', label: 'Studio' },
  { href: '#gallery', label: 'Gallery' },
  { href: '#how', label: 'How it works' },
];

export function Navbar({ onTestQR }: { onTestQR: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${scrolled ? 'bg-paper/85 backdrop-blur-md border-b border-line' : 'bg-transparent'}`}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
        <a href="#top" aria-label="DOTRA home" className="shrink-0">
          <Logo size={26} />
        </a>
        <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="px-3.5 py-1.5 rounded-full text-sm text-mute hover:text-ink hover:bg-neutral-100 transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTestQR}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink bg-white border border-line rounded-full px-3.5 py-1.5 hover:border-neutral-300 hover:shadow-card transition-all"
          >
            <ScanLine size={15} />
            <span className="hidden sm:inline">Test a QR</span>
            <span className="sm:hidden">Test</span>
          </button>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="DOTRA on GitHub"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-line bg-white text-ink hover:border-neutral-300 hover:shadow-card transition-all"
          >
            <GithubIcon size={16} />
          </a>
        </div>
      </div>
    </header>
  );
}
