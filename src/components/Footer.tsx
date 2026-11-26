import { LogoMark } from './Logo';
import { GITHUB_URL } from './Navbar';

export function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        <div className="flex items-center gap-3">
          <LogoMark size={26} />
          <div>
            <p className="font-display font-semibold text-sm tracking-tight">DOTRA</p>
            <p className="text-xs text-mute">Every dot tells a story.</p>
          </div>
        </div>
        <p className="text-xs text-mute max-w-md leading-relaxed">
          100% client-side. Your images and links never leave this tab — no servers,
          no uploads, no accounts. Verification happens on the actual rendered pixels.
        </p>
        <div className="flex items-center gap-5 text-sm">
          <a href="#studio" className="text-mute hover:text-ink transition-colors">Studio</a>
          <a href="#how" className="text-mute hover:text-ink transition-colors">How it works</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-mute hover:text-ink transition-colors">GitHub</a>
        </div>
      </div>
      <div className="border-t border-line/70">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 text-[11px] text-mute">
          DOTRA renders genuine ISO/IEC 18004 QR codes and verifies every result with jsQR before any download is enabled.
        </div>
      </div>
    </footer>
  );
}
