import { motion } from 'framer-motion';
import { ScanLine, QrCode, ShieldCheck, Lock, Wrench, Eye } from 'lucide-react';

const STEPS = [
  {
    n: '01',
    icon: ScanLine,
    title: 'Sample the image',
    body: 'Your image is cropped, tone-adjusted and resampled onto the QR grid. Each data module receives the colour of its own tiny patch of the artwork — dark modules keep their depth, light modules stay luminous.',
  },
  {
    n: '02',
    icon: QrCode,
    title: 'Weave a genuine QR',
    body: 'A real ISO/IEC 18004 matrix is generated from your link. Finder, timing, alignment and version patterns render as pure black and white; only the data modules carry image colour, so the code stays structurally perfect.',
  },
  {
    n: '03',
    icon: ShieldCheck,
    title: 'Verify, then export',
    body: 'jsQR decodes the actual rendered raster — not the internal matrix. If anything is ambiguous, DOTRA escalates through five repair strategies and re-verifies. Downloads unlock only for pixels that decode.',
  },
];

const REPAIRS = [
  'Stronger tone separation',
  'Tone separation + desaturation',
  'Full-size dots, no gaps',
  'Maximum redundancy (EC level H)',
];

export function HowItWorks() {
  return (
    <section id="how" className="max-w-7xl mx-auto px-5 sm:px-8 py-20 scroll-mt-16">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.55 }}
        className="max-w-2xl mb-10"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-mute">How it works</p>
        <h2 className="font-display font-bold tracking-tight text-3xl sm:text-4xl text-ink mt-2">
          Beautiful <em className="not-italic underline decoration-neutral-300 underline-offset-4">and</em> honest
        </h2>
        <p className="text-mute text-[15px] leading-relaxed mt-3">
          DOTRA never fakes a QR code. Every dot you see is a real data module of a
          genuine matrix — and every result is proven scannable before you can download it.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-5">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="bg-white rounded-2xl border border-line shadow-card p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-ink">
                <s.icon size={18} />
              </span>
              <span className="font-display font-bold text-4xl tracking-tighter text-neutral-200">{s.n}</span>
            </div>
            <h3 className="font-display font-semibold text-lg tracking-tight text-ink">{s.title}</h3>
            <p className="text-sm text-mute leading-relaxed mt-2">{s.body}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-5">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5 }}
          className="bg-ink text-paper rounded-2xl p-7"
        >
          <div className="flex items-center gap-2.5 mb-3">
            <Eye size={17} className="text-paper/80" />
            <h3 className="font-display font-semibold text-lg tracking-tight">The verification gate</h3>
          </div>
          <p className="text-sm text-paper/70 leading-relaxed">
            Most “QR generators” only check the matrix they built. DOTRA decodes the
            final rasterized image — the same pixels you would print or share — with
            jsQR, and compares the payload against your link. If the decode disagrees,
            the file is never offered.
          </p>
          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-paper/50 mb-2.5 flex items-center gap-1.5">
              <Wrench size={12} /> Automatic repair ladder
            </p>
            <ol className="space-y-1.5">
              {REPAIRS.map((r, i) => (
                <li key={r} className="flex items-center gap-2.5 text-[13px] text-paper/80">
                  <span className="w-5 h-5 rounded-full border border-paper/25 text-[10px] flex items-center justify-center shrink-0">{i + 2}</span>
                  {r}
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-paper/50 mt-3 leading-relaxed">
              Step 1 is the chosen quality mode. The encoded URL never changes during repair.
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="bg-white rounded-2xl border border-line shadow-card p-7 flex flex-col"
        >
          <div className="flex items-center gap-2.5 mb-3">
            <Lock size={16} className="text-ok" />
            <h3 className="font-display font-semibold text-lg tracking-tight">Private by construction</h3>
          </div>
          <p className="text-sm text-mute leading-relaxed">
            DOTRA is a single static page. There is no server, no database, no account
            and no analytics on your content. Image sampling, QR encoding, particle
            animation, jsQR verification and every export run entirely in your browser
            tab. Close the tab and nothing remains anywhere.
          </p>
          <div className="mt-5 space-y-2.5">
            {[
              'Images never leave your device',
              'Links are encoded locally, never logged',
              'Verification decodes the real rendered pixels',
              'Exports are re-verified at their own resolution',
            ].map((t) => (
              <div key={t} className="flex items-center gap-2.5 text-[13px] text-ink/80">
                <ShieldCheck size={14} className="text-ok shrink-0" />
                {t}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
