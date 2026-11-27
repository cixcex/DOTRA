// ---------------------------------------------------------------------------
// DOTRA Engine Lab — engine registry
//
// Three render engines share ONE encoded matrix (same URL, same error
// correction) and ONE jsQR verification gate. The compare mode renders the
// same URL + photograph through all of them and lets the decoder decide.
// ---------------------------------------------------------------------------

export { renderHalftone, HALFTONE_DEFAULTS, type HalftoneOptions, type HalftoneInput } from './halftoneEngine';
export {
  renderArtistic, ARTISTIC_DEFAULTS, type ArtisticOptions, type ArtisticInput,
  type ArtisticPixelStyle, type ArtisticMarkerShape, type ArtisticMarkerInner, type NoiseSpace,
} from './artisticEngine';
export { computeMetrics, type EngineMetrics, type MetricsInput } from './compare';
export { Raster, WHITE, BLACK, hexToRgba, mulberry32, type RGBA } from './raster';

export type EngineId = 'composite' | 'halftone' | 'artistic';

export interface EngineMeta {
  id: EngineId;
  label: string;
  origin: string;
  originUrl: string;
  license: string;
  animated: boolean; // supports the particle assembly animation
  description: string;
}

export const ENGINE_META: Record<EngineId, EngineMeta> = {
  composite: {
    id: 'composite',
    label: 'Composite',
    origin: 'DOTRA engine v3',
    originUrl: 'https://github.com/cixcex/DOTRA',
    license: 'MIT',
    animated: true,
    description:
      'Full-bleed photograph beneath a grid of B&W square modules; image influence blends the photo through each module.',
  },
  halftone: {
    id: 'halftone',
    label: 'Halftone',
    origin: 'visual-qrcode (JeSuisUnCaillou)',
    originUrl: 'https://github.com/JeSuisUnCaillou/visual-qrcode',
    license: 'MIT',
    animated: false,
    description:
      'Halftone QR: every module is a 3×3 sub-pixel block — the centre carries the data, the 8 surrounding pixels show the photograph. EC level H.',
  },
  artistic: {
    id: 'artistic',
    label: 'Artistic',
    origin: 'qrcode-toolkit via artistic-qrcode-generator (duanxianpi / antfu)',
    originUrl: 'https://github.com/duanxianpi/artistic-qrcode-generator',
    license: 'MIT',
    animated: false,
    description:
      'Toolkit styling: shaped modules, geometric finder markers, seeded margin noise, crystalize / liquidify effects and an optional perspective tilt.',
  },
};

export const ENGINE_IDS: EngineId[] = ['composite', 'halftone', 'artistic'];
