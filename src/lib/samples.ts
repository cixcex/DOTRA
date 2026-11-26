// ---------------------------------------------------------------------------
// DOTRA sample gallery registry — 24 procedurally generated, license-free
// artworks (scripts/generate-samples.mjs). Bundled at build time; no network.
// ---------------------------------------------------------------------------

import abstractInterference from '@/assets/samples/abstract-interference.png';
import abstractMesh from '@/assets/samples/abstract-mesh.png';
import abstractRadial from '@/assets/samples/abstract-radial.png';
import animalsButterfly from '@/assets/samples/animals-butterfly.png';
import animalsKingfisher from '@/assets/samples/animals-kingfisher.png';
import animalsReef from '@/assets/samples/animals-reef.png';
import architectureArches from '@/assets/samples/architecture-arches.png';
import architectureFacade from '@/assets/samples/architecture-facade.png';
import architectureSkyline from '@/assets/samples/architecture-skyline.png';
import landscapesAlpine from '@/assets/samples/landscapes-alpine.png';
import landscapesAurora from '@/assets/samples/landscapes-aurora.png';
import landscapesDunes from '@/assets/samples/landscapes-dunes.png';
import minimalBauhaus from '@/assets/samples/minimal-bauhaus-comp.png';
import minimalMonochrome from '@/assets/samples/minimal-monochrome.png';
import minimalRhythm from '@/assets/samples/minimal-rhythm.png';
import natureEmberRidge from '@/assets/samples/nature-ember-ridge.png';
import natureTide from '@/assets/samples/nature-tide.png';
import natureVerdant from '@/assets/samples/nature-verdant.png';
import portraitsBauhausFace from '@/assets/samples/portraits-bauhaus-face.png';
import portraitsEmberProfile from '@/assets/samples/portraits-ember-profile.png';
import portraitsLineStudy from '@/assets/samples/portraits-line-study.png';
import technologyCircuit from '@/assets/samples/technology-circuit.png';
import technologyHexgrid from '@/assets/samples/technology-hexgrid.png';
import technologyPixelrain from '@/assets/samples/technology-pixelrain.png';

export type SampleCategory =
  | 'abstract' | 'animals' | 'architecture' | 'landscapes'
  | 'minimal' | 'nature' | 'portraits' | 'technology';

export interface SampleItem {
  id: string;
  name: string;
  category: SampleCategory;
  src: string;
  url: string; // default URL encoded when this sample is selected
}

export const SAMPLE_CATEGORIES: { id: SampleCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'animals', label: 'Animals' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'landscapes', label: 'Landscapes' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'nature', label: 'Nature' },
  { id: 'portraits', label: 'Portraits' },
  { id: 'technology', label: 'Technology' },
];

export const SAMPLES: SampleItem[] = [
  { id: 'abstract-interference', name: 'Interference', category: 'abstract', src: abstractInterference, url: 'https://dotra.app/gallery/abstract/interference' },
  { id: 'abstract-mesh', name: 'Mesh', category: 'abstract', src: abstractMesh, url: 'https://dotra.app/gallery/abstract/mesh' },
  { id: 'abstract-radial', name: 'Radial', category: 'abstract', src: abstractRadial, url: 'https://dotra.app/gallery/abstract/radial' },
  { id: 'animals-butterfly', name: 'Butterfly', category: 'animals', src: animalsButterfly, url: 'https://dotra.app/gallery/animals/butterfly' },
  { id: 'animals-kingfisher', name: 'Kingfisher', category: 'animals', src: animalsKingfisher, url: 'https://dotra.app/gallery/animals/kingfisher' },
  { id: 'animals-reef', name: 'Reef', category: 'animals', src: animalsReef, url: 'https://dotra.app/gallery/animals/reef' },
  { id: 'architecture-arches', name: 'Arches', category: 'architecture', src: architectureArches, url: 'https://dotra.app/gallery/architecture/arches' },
  { id: 'architecture-facade', name: 'Facade', category: 'architecture', src: architectureFacade, url: 'https://dotra.app/gallery/architecture/facade' },
  { id: 'architecture-skyline', name: 'Skyline', category: 'architecture', src: architectureSkyline, url: 'https://dotra.app/gallery/architecture/skyline' },
  { id: 'landscapes-alpine', name: 'Alpine', category: 'landscapes', src: landscapesAlpine, url: 'https://dotra.app/gallery/landscapes/alpine' },
  { id: 'landscapes-aurora', name: 'Aurora', category: 'landscapes', src: landscapesAurora, url: 'https://dotra.app/gallery/landscapes/aurora' },
  { id: 'landscapes-dunes', name: 'Dunes', category: 'landscapes', src: landscapesDunes, url: 'https://dotra.app/gallery/landscapes/dunes' },
  { id: 'minimal-bauhaus-comp', name: 'Bauhaus Composition', category: 'minimal', src: minimalBauhaus, url: 'https://dotra.app/gallery/minimal/bauhaus-composition' },
  { id: 'minimal-monochrome', name: 'Monochrome', category: 'minimal', src: minimalMonochrome, url: 'https://dotra.app/gallery/minimal/monochrome' },
  { id: 'minimal-rhythm', name: 'Rhythm', category: 'minimal', src: minimalRhythm, url: 'https://dotra.app/gallery/minimal/rhythm' },
  { id: 'nature-ember-ridge', name: 'Ember Ridge', category: 'nature', src: natureEmberRidge, url: 'https://dotra.app/gallery/nature/ember-ridge' },
  { id: 'nature-tide', name: 'Tide', category: 'nature', src: natureTide, url: 'https://dotra.app/gallery/nature/tide' },
  { id: 'nature-verdant', name: 'Verdant', category: 'nature', src: natureVerdant, url: 'https://dotra.app/gallery/nature/verdant' },
  { id: 'portraits-bauhaus-face', name: 'Bauhaus Face', category: 'portraits', src: portraitsBauhausFace, url: 'https://dotra.app/gallery/portraits/bauhaus-face' },
  { id: 'portraits-ember-profile', name: 'Ember Profile', category: 'portraits', src: portraitsEmberProfile, url: 'https://dotra.app/gallery/portraits/ember-profile' },
  { id: 'portraits-line-study', name: 'Line Study', category: 'portraits', src: portraitsLineStudy, url: 'https://dotra.app/gallery/portraits/line-study' },
  { id: 'technology-circuit', name: 'Circuit', category: 'technology', src: technologyCircuit, url: 'https://dotra.app/gallery/technology/circuit' },
  { id: 'technology-hexgrid', name: 'Hexgrid', category: 'technology', src: technologyHexgrid, url: 'https://dotra.app/gallery/technology/hexgrid' },
  { id: 'technology-pixelrain', name: 'Pixel Rain', category: 'technology', src: technologyPixelrain, url: 'https://dotra.app/gallery/technology/pixel-rain' },
];

export const sampleById = (id: string): SampleItem | undefined => SAMPLES.find((s) => s.id === id);
