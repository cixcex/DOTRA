import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, CheckCircle2, Sparkles } from 'lucide-react';
import { encodeQR } from '@/engine/qrGenerator';
import { processImage } from '@/engine/imageProcessor';
import { buildDotPlan, renderPlanToCanvas } from '@/engine/dotRenderer';
import { createScene, type ParticleScene } from '@/engine/particleEngine';
import { verifyCanvas } from '@/engine/qrVerifier';
import type { MatrixInfo, ImageAdjustments, CropTransform } from '@/engine/types';
import type { DotPlan } from '@/engine/dotRenderer';
import { useParticleAnimation } from '@/hooks/useParticleAnimation';
import { HERO_DEMO_URL } from '@/lib/constants';
import natureEmberRidge from '@/assets/samples/nature-ember-ridge.png';

const PREVIEW_PX = 640;

/** Self-contained looping demo: a real dot-QR assembling itself, verified live. */
function HeroDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<ParticleScene | null>(null);
  const [plan, setPlan] = useState<DotPlan | null>(null);
  const [matrix, setMatrix] = useState<MatrixInfo | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [photoSrc, setPhotoSrc] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('demo image failed to load'));
          img.src = natureEmberRidge;
        });
        if (cancelled) return;

        const matrix = encodeQR(HERO_DEMO_URL, 'H', 'large').matrix;
        const processed = processImage(
          img,
          {
            crop: { zoom: 1, x: 0, y: 0 } as CropTransform,
            matrixSize: matrix.size,
            adjustments: { brightness: 0, contrast: 0, saturation: 0 } as ImageAdjustments,
            enhance: { smartCrop: true, autoContrast: true, clahe: true, sharpen: true },
          },
        );
        const plan = buildDotPlan({
          matrix,
          processed,
          dots: { shape: 'pixel', size: 0.88, spacing: 0.02, density: 1, colorIntensity: 1, influence: 0.6, moduleContrast: 0.85, bwIntensity: 1, colourTreatment: false },
          preset: 'balanced',
          repairLevel: 0,
        });
        const scene = createScene(plan, matrix, PREVIEW_PX, 6, {
          preset: 'gather', duration: 3.4, speed: 1, intensity: 0.55, startDistance: 1, easing: 'easeOut',
        });

        // Verify the exact static frame jsQR would see — the same photographic
        // composite (underlay + square modules + perforation ring) as the export.
        const staticCanvas = renderPlanToCanvas(plan, matrix, {
          quietZone: 6, bgColor: '#ffffff', transparent: false,
          shape: 'pixel', dotSize: 0.88, spacing: 0.02, fragmentSource: plan.fragmentSource,
          photoUnderlay: processed.detail, perforationBorder: true,
        }, 540);
        const outcome = await verifyCanvas(staticCanvas, HERO_DEMO_URL);

        if (cancelled) return;
        setMatrix(matrix);
        setPlan(plan);
        setScene(scene);
        setPhotoSrc(processed.detail);
        setVerified(outcome.verified);
        if (!outcome.verified) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useParticleAnimation({
    canvasRef,
    scene,
    plan,
    matrix,
    renderOpts: {
      quietZone: 6,
      bgColor: '#ffffff',
      transparent: false,
      shape: 'pixel',
      dotSize: 0.88,
      spacing: 0.02,
      fragmentSource: plan?.fragmentSource ?? null,
      photoUnderlay: photoSrc,
      perforationBorder: true,
    },
    photoSource: photoSrc,
    easing: 'easeOut',
    playing: true,
    replayKey: 0,
    loop: true,
  });

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={PREVIEW_PX}
        height={PREVIEW_PX}
        className="w-full h-auto rounded-xl border border-line bg-white shadow-lift"
        aria-label="Live DOTRA demo: a QR code assembling from black-and-white square modules over the photograph"
      />
      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur border border-line px-2.5 py-1 text-[11px] font-medium text-ink shadow-card">
        {verified === null && !failed && <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 anim-pulse-dot" />}
        {verified === true && <CheckCircle2 size={12} className="text-ok" />}
        {failed && <span className="w-1.5 h-1.5 rounded-full bg-bad" />}
        {verified === null && !failed && 'Assembling…'}
        {verified === true && `jsQR verified · ${HERO_DEMO_URL}`}
        {failed && 'Demo unavailable in this browser'}
      </div>
    </div>
  );
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

export function Hero({ onTestQR }: { onTestQR: () => void }) {
  return (
    <section className="relative overflow-hidden grain">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 pt-28 sm:pt-36 pb-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
        <div>
          <motion.div {...fadeUp} transition={{ duration: 0.6 }} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-mute shadow-card">
            <Sparkles size={13} className="text-ok" />
            Image-native QR codes, assembled from thousands of dots
          </motion.div>
          <motion.h1
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.06 }}
            className="font-display font-bold tracking-tightest text-ink text-5xl sm:text-6xl lg:text-[68px] leading-[1.02] mt-6"
          >
            Every dot<br />tells a story.
          </motion.h1>
          <motion.p
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="text-mute text-lg leading-relaxed mt-6 max-w-xl"
          >
            DOTRA turns any image into a genuinely scannable QR code made of coloured
            dots — assembled live with a particle animation, then verified against the
            actual rendered pixels with jsQR before a single byte leaves your browser.
          </motion.p>
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="flex flex-wrap items-center gap-3 mt-8"
          >
            <a
              href="#studio"
              className="inline-flex items-center gap-2 rounded-full bg-ink text-paper text-sm font-medium px-5 py-2.5 hover:bg-neutral-800 active:scale-[0.98] transition-all"
            >
              Start creating
              <ArrowDown size={15} />
            </a>
            <button
              type="button"
              onClick={onTestQR}
              className="inline-flex items-center gap-2 rounded-full bg-white border border-line text-ink text-sm font-medium px-5 py-2.5 hover:border-neutral-300 hover:shadow-card active:scale-[0.98] transition-all"
            >
              Test a QR camera
            </button>
          </motion.div>
          <motion.dl
            {...fadeUp}
            transition={{ duration: 0.6, delay: 0.24 }}
            className="grid grid-cols-3 gap-6 mt-12 max-w-md"
          >
            {[
              ['5,300+', 'dots per code'],
              ['100%', 'client-side'],
              ['jsQR', 'pixel verification'],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="sr-only">{l}</dt>
                <dd className="font-display font-bold text-2xl tracking-tight text-ink">{v}</dd>
                <dd className="text-xs text-mute mt-0.5">{l}</dd>
              </div>
            ))}
          </motion.dl>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <HeroDemo />
        </motion.div>
      </div>
    </section>
  );
}
