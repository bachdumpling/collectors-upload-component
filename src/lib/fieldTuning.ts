/** Everything about the wave field's look, shared by every pane on /test. */
export type FieldTuning = {
  // camera
  zoom: number;
  tilt: number;
  height: number;
  parallax: number;
  // wave shape
  amplitude: number;
  waveScale: number;
  waveRatio: number;
  swell: number;
  turbulence: number;
  speed: number;
  // colour
  horizonColor: string;
  waveColor: string;
  crestColor: string;
  fogDepth: number;
  brightness: number;
  opacity: number;
  band: number;
  // composition
  globe: number;
  grainIntensity: number;
};

const BASE = {
  waveScale: 0.6,
  waveRatio: 0.3,
  swell: 35,
  turbulence: 45,
  speed: 0.65,
  opacity: 1,
  grainIntensity: 0.022,
  parallax: 1.6,
  // Measured off the Figma: #2583FF is the liquid body.
  horizonColor: '#0733e0',
  waveColor: '#1f7bff',
  crestColor: '#6aadff'
};

export const TUNING: Record<'field' | 'globe', FieldTuning> = {
  // Looking almost straight down a narrow cone: every ray hits the surface, so the
  // liquid fills the zone corner to corner.
  field: { ...BASE, zoom: 0.85, tilt: 0.12, amplitude: 4.2, height: 0.5, fogDepth: 60, brightness: 1.06, globe: 0, band: 0.08 },

  // A centred sphere: `globe` masks coverage radially, `band` sets how many shells the
  // depth ramp packs into the mass. Dialled on the bench.
  globe: { ...BASE, zoom: 0.86, tilt: 0.49, amplitude: 4.6, height: 1.5, fogDepth: 56, brightness: 1, globe: 0.7, band: 0.185 }
};
