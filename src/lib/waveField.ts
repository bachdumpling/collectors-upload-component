/**
 * The wave field: its shader, the values that drive it, and the handle every renderer
 * exposes.
 *
 * This lives apart from any renderer on purpose. Two of them draw this same shader --
 * LiquidGlassField through OGL for the bench, TransmissionField through three.js for
 * the zone -- and the zone should not have to import the bench's component to reach a
 * string of GLSL.
 *
 * Nothing here imports a WebGL library, so importing the shader does not drag one in:
 * that is what keeps OGL out of the chunk the upload zone ships in.
 */

export const vertex = /* glsl */ `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

/** Exported so /test can render the identical field into a three.js FBO and put a
 *  MeshTransmissionMaterial lattice in front of it -- same background, different glass. */
export const fragment = /* glsl */ `#version 300 es
precision highp float;

uniform vec2  iResolution;
uniform float iTime;

// -- wave field ------------------------------------------------------------
uniform float uSpeed, uAmplitude, uWaveScale, uWaveRatio;
uniform float uSwell, uTurbulence, uTilt, uZoom, uHeight;
uniform float uFogDepth, uSteps, uBrightness, uOpacity;
uniform float uGrain, uGrainIntensity;
uniform vec2  uMouse;
uniform float uParallax;

// calm palette (blue) and alarm palette (red), crossfaded by uTint
uniform vec3  uHorizonA, uWaveA, uCrestA;
uniform vec3  uHorizonB, uWaveB, uCrestB;
uniform float uTint;

// -- glass lattice ---------------------------------------------------------
uniform float uGridN;       // tiles per axis
uniform float uTileRadius;  // corner radius, in tile units (1.0 == one tile)
uniform float uFrost;       // 0 = clear, 1 = fully homogenised
uniform float uLens;        // edge refraction, how hard the rim bends light
uniform float uChroma;      // channel split at the rim, 0 disables the extra marches
uniform float uRim;         // rim highlight opacity
uniform float uGridShift;   // lattice counter-parallax, in tile units
uniform float uLattice;     // 1 = draw the glass lattice, 0 = bare wave field
uniform float uGlobe;       // 1 = mask coverage into a centred sphere
uniform float uBand;        // depth->colour sensitivity; higher packs more shells in

// -- state -----------------------------------------------------------------
uniform float uFill;        // 0..1 waterline
uniform float uHover;       // 0..1
uniform float uDrag;        // 0..1

out vec4 fragColor;

const float MAX_DIST = 20000.0;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += uTurbulence * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

// signed distance to a rounded box, centred at origin, half-extent h
float sdRoundBox(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// One camera ray, marched. Split out of main so the rim can march it more than once
// for chromatic dispersion without duplicating the ray construction.
vec3 sampleField(vec2 pw, vec2 freq, vec4 tc, vec3 horizon, vec3 wave, vec3 crest, out float cov) {
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3  cam  = vec3(0.0, 0.0, 30.0);

  vec2 uv = pw - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3  dir  = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float c = cos(vfov * ulen), s = sin(vfov * ulen);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt); s = sin(uTilt);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  // Pointer parallax drives the *background* only, so the fixed lattice sits in front.
  // It opens up as the pointer arrives: at rest the field is still, on hover it swings.
  float par   = uParallax * (0.10 + 0.45 * uHover);
  float yaw   = (uMouse.x - 0.5) * par;
  float pitch = (uMouse.y - 0.5) * par;
  c = cos(yaw);   s = sin(yaw);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
  c = cos(pitch); s = sin(pitch);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;

  float dist = raymarch(cam, dir, freq, tc);
  vec3  wpos = cam + dist * dir;

  float t    = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);
  vec3  body = mix(wave, crest, clamp(wpos.z * uBand + 0.5, 0.0, 1.0));
  cov = clamp(t, 0.0, 1.0) * uOpacity;
  return clamp(mix(horizon, body, t) * uBrightness, 0.0, 1.0);
}

void main() {
  vec2 p = gl_FragCoord.xy / iResolution.xy;   // 0..1, y up

  // ---- glass lattice geometry -------------------------------------------
  // Tiles butt edge to edge; the visible grid comes from the rims doubling at
  // the seams and the corner radii carving diamonds at four-way junctions.
  vec2 shift = vec2(uMouse.x - 0.5, uMouse.y - 0.5) * uGridShift;
  vec2 g     = (p + shift) * uGridN;
  vec2 cell  = floor(g);
  vec2 f     = fract(g) - 0.5;                 // -0.5..0.5 inside the tile

  float d  = sdRoundBox(f, vec2(0.5), uTileRadius);
  float aa = fwidth(d) + 1e-5;

  float inside = (1.0 - smoothstep(-aa, aa, d)) * uLattice; // 1 in the tile, 0 in the gaps

  // Frost: pull the sample toward the tile centre. Lifting it on hover/drag makes
  // the glass "thicken" -- the parallax below then reads as depth rather than drift.
  vec2 cellCentre = (cell + 0.5) / uGridN - shift;
  float frost = uFrost * (1.0 + 0.10 * uHover + 0.22 * uDrag);
  vec2 pw = mix(p, cellCentre, clamp(frost, 0.0, 0.97) * inside);

  // Edge lens: bend outward near the rim, the way a real bevel does.
  float edge = smoothstep(-0.42, -0.02, d) * inside;
  vec2  nrm  = length(f) > 1e-5 ? normalize(f) : vec2(0.0);
  vec2  disp = nrm * edge * uLens * (1.0 + 0.6 * uDrag) / uGridN;

  // ---- wave field, sampled through the glass ----------------------------
  float T    = iTime * uSpeed;
  vec2  freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4  tc   = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);

  vec3 horizon = mix(uHorizonA, uHorizonB, uTint);
  vec3 wave    = mix(uWaveA,    uWaveB,    uTint);
  vec3 crest   = mix(uCrestA,   uCrestB,   uTint);

  float cov;
  vec3  col = sampleField(pw + disp, freq, tc, horizon, wave, crest, cov);

  // Chromatic dispersion. Real glass splits the channels at its edge, and that fringe
  // is most of what separates "glass" from "frosted". It is only visible in a thin band
  // at the rim, so the two extra marches are gated to that band -- interiors and gaps,
  // which are the bulk of the pixels, still cost one march.
  float fringe = smoothstep(-0.17, -0.005, d) * inside;
  if (uChroma > 0.0001 && fringe > 0.01) {
    float k = uChroma * fringe / uGridN;
    float ignored;
    float cr = sampleField(pw + disp + nrm * k,        freq, tc, horizon, wave, crest, ignored).r;
    float cb = sampleField(pw + disp - nrm * k * 1.35, freq, tc, horizon, wave, crest, ignored).b;
    col = vec3(cr, col.g, cb);
  }

  // Blue and red sit on opposite sides of the wheel, so a straight crossfade drags
  // the liquid through magenta. Pulling the saturation out at the midpoint routes it
  // through a pale wash instead: the colour drains, then comes back wrong.
  float bow = 1.0 - abs(uTint * 2.0 - 1.0);
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), bow * 0.8);

  // ---- waterline ---------------------------------------------------------
  // The reference is a single blurred rect rising from the bottom: a soft level, no
  // hard edge. It runs the full width -- the liquid fills the zone side to side.
  float wob = (sin(p.x * 6.2 + iTime * 0.9) * 0.013 + sin(p.x * 11.7 - iTime * 1.3) * 0.007)
            * smoothstep(0.02, 0.30, uFill) * (1.0 - smoothstep(0.88, 1.0, uFill));
  float line = mix(-0.16, 1.10, uFill) + wob;
  float level = 1.0 - smoothstep(line - 0.20, line + 0.16, p.y);

  cov *= level;

  // Globe: a soft radial mask centred on the zone. The wide-fisheye tuning already
  // thins the edges on its own; this only tidies the silhouette so it reads round
  // rather than merely faded.
  if (uGlobe > 0.001) {
    vec2  q   = (p - 0.5) * vec2(iResolution.x / iResolution.y, 1.0) * 2.0;
    float orb = 1.0 - smoothstep(0.78, 1.34, length(q));
    cov *= mix(1.0, orb * orb, uGlobe);
  }

  vec3 outCol = mix(vec3(1.0), col, clamp(cov, 0.0, 1.0));

  // ---- rim + lattice ghost ----------------------------------------------
  // 1px rim, uniform on all four edges (measured off the Figma rig -- it is a flat
  // border, not a directional bevel), plus a whisper of grey in the gaps so the
  // lattice still reads on a white zone with nothing behind it.
  float rimW = 1.4 / (iResolution.y / uGridN);
  float rim  = smoothstep(-rimW - aa, -rimW + aa, d) * (1.0 - smoothstep(-aa, aa, d));
  outCol = mix(outCol, vec3(1.0), rim * uRim * (0.65 + 0.35 * cov) * uLattice);

  float gap = smoothstep(-aa, aa * 2.0, d);
  outCol = mix(outCol, vec3(0.62, 0.64, 0.70), gap * 0.042 * (1.0 - cov * 0.7) * uLattice);

  // A hairline on the seam itself, so at rest the lattice reads as tiles rather than
  // as scattered dots at the junctions. Measured off the Figma block: 251 on 255.
  float seam = 1.0 - smoothstep(0.0, 0.018, abs(d));
  outCol = mix(outCol, vec3(0.60, 0.62, 0.68), seam * 0.055 * (1.0 - cov * 0.55) * uLattice);

  if (uGrain > 0.5) {
    float gr = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    outCol += (gr - 0.5) * uGrainIntensity * (0.15 + 0.5 * cov);
  }

  fragColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
}
`;

export type FieldTargets = {
  fill: number;
  tint: number;
  hover: number;
  drag: number;
  /** How "opened up" the zone is, 0..1. Drives the camera pull-in on TransmissionField
   *  so uploading and error states stay zoomed rather than snapping back to rest. */
  engage: number;
  /** 0 gathers the mass into a centred globe, 1 spreads it across the whole zone.
   *  Read by TransmissionField; LiquidGlassField takes its globe from a prop instead. */
  spread: number;
};

export type FieldHandle = {
  /** Set smoothed targets. Anything omitted keeps its current target. */
  set(next: Partial<FieldTargets>): void;
  /** Jump a value with no easing -- for resets. */
  snap(next: Partial<FieldTargets>): void;
  /**
   * Pointer position, 0..1 with y up. The parent owns this because the zone stacks a
   * full-bleed click target over the canvas; if the canvas listened for itself, the
   * button would eat every move event and the parallax would die.
   */
  setPointer(x: number, y: number): void;
  /** Force one frame. The loop pauses when the tab is hidden, so anything that sets
   *  values imperatively (the /test bench) needs a way to see the result. */
  draw(): void;
};

/** Per-target smoothing, as the fraction of the gap closed per 60fps frame.
 *  Fill is slower than the rest so progress reads as liquid, not as a slider. */
export const EASE: Record<keyof FieldTargets, number> = {
  fill: 0.09,
  tint: 0.085,
  hover: 0.12,
  drag: 0.16,
  engage: 0.055,
  spread: 0.035
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
};

/** Measured off the Figma: #2583FF is the liquid body. The horizon is the deeper blue
 *  the mass fades into with distance, the crest the highlight on the nearest waves. */
export const CALM = { horizon: '#0f2bff', wave: '#68a6fd', crest: '#2432ff' };
export const ALARM = { horizon: '#ff5c5c', wave: '#f27d7d', crest: '#f41515' };

/** Raymarch quality tiers -- how many steps each ray is allowed. */
export const STEPS = { low: 40, medium: 70, high: 110 } as const;
