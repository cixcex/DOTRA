import { motion } from 'framer-motion';
import { GalleryPanel } from './GalleryPanel';
import type { SampleItem } from '@/lib/samples';

export function GallerySection({
  activeId, onSelect,
}: {
  activeId: string | null;
  onSelect: (sample: SampleItem) => void;
}) {
  return (
    <section id="gallery" className="border-t border-line bg-white scroll-mt-16">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-20">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.55 }}
          className="max-w-2xl mb-8"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-mute">Gallery</p>
          <h2 className="font-display font-bold tracking-tight text-3xl sm:text-4xl text-ink mt-2">
            Twenty-four seeded artworks
          </h2>
          <p className="text-mute text-[15px] leading-relaxed mt-3">
            Every sample is generated procedurally at build time — deterministic,
            license-free, and bundled with the app. No external assets, no network
            requests. Click any artwork to load it into the studio with its demo link.
          </p>
        </motion.div>
        <GalleryPanel activeId={activeId} onSelect={onSelect} />
      </div>
    </section>
  );
}
