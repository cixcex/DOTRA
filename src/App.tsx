import { useState, useCallback, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Studio } from './components/Studio';
import { GallerySection } from './components/GallerySection';
import { HowItWorks } from './components/HowItWorks';
import { Footer } from './components/Footer';
import { TestQRModal } from './components/TestQRModal';
import type { SampleItem } from './lib/samples';

export default function App() {
  const [testOpen, setTestOpen] = useState(false);
  const [galleryActive, setGalleryActive] = useState<string | null>('nature-ember-ridge');

  // The studio dispatches this when its compact library is used; keep the
  // gallery section's highlight in sync.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === 'string') setGalleryActive(id);
    };
    window.addEventListener('dotra:select-sample', handler);
    return () => window.removeEventListener('dotra:select-sample', handler);
  }, []);

  const openTestQR = useCallback(() => setTestOpen(true), []);

  // Gallery clicks: the studio owns the loader; bring it into view.
  const handleSample = useCallback((sample: SampleItem) => {
    window.dispatchEvent(new CustomEvent('dotra:select-sample', { detail: sample.id }));
    document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleUseUrl = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent('dotra:set-url', { detail: text }));
    document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <div id="top" className="min-h-screen bg-paper text-ink font-sans">
      <Navbar onTestQR={openTestQR} />
      <main>
        <Hero onTestQR={openTestQR} />
        <Studio />
        <GallerySection activeId={galleryActive} onSelect={handleSample} />
        <HowItWorks />
      </main>
      <Footer />
      <TestQRModal open={testOpen} onClose={() => setTestOpen(false)} onUseUrl={handleUseUrl} />
    </div>
  );
}
