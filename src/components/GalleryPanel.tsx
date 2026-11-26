import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { SAMPLES, SAMPLE_CATEGORIES, type SampleCategory, type SampleItem } from '@/lib/samples';

export function GalleryPanel({
  activeId, onSelect, compact = false,
}: {
  activeId: string | null;
  onSelect: (sample: SampleItem) => void;
  compact?: boolean;
}) {
  const [category, setCategory] = useState<SampleCategory | 'all'>('all');
  const items = useMemo(
    () => (category === 'all' ? SAMPLES : SAMPLES.filter((s) => s.category === category)),
    [category],
  );

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {SAMPLE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === c.id ? 'bg-ink text-paper' : 'bg-neutral-100 text-mute hover:text-ink'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className={`grid gap-3 ${compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
        {items.map((s, i) => {
          const active = s.id === activeId;
          return (
            <motion.button
              key={s.id}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.02, 0.3) }}
              onClick={() => onSelect(s)}
              className={`group relative rounded-xl overflow-hidden border text-left transition-all duration-150 ${
                active ? 'border-ink shadow-card ring-1 ring-ink' : 'border-line hover:border-neutral-300 hover:shadow-card'
              }`}
            >
              <div className="aspect-square w-full bg-neutral-100">
                <img src={s.src} alt={s.name} loading="lazy" className="w-full h-full object-cover" />
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent px-2.5 pt-6 pb-2">
                <p className="text-[11px] font-medium text-white truncate">{s.name}</p>
              </div>
              {active && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-ok text-white flex items-center justify-center shadow">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
