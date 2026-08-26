import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Mesh, Program, Renderer, Triangle } from 'ogl';
import {
  ALARM,
  CALM,
  EASE,
  STEPS,
  fragment,
  hexToRgb,
  vertex,
  type FieldHandle,
  type FieldTargets
} from '@/lib/waveField';

/**
 * The whole visual is one draw call.
 *
 * The wave field is a raymarched sine-plasma, forked from react-bits `GradientWaves`
 * (https://reactbits.dev) and retuned; the glass below is mine.
 * The glass lattice is folded into the *same* fragment shader as a pre-step: before a
 * pixel builds its camera ray, it asks which tile it belongs to and warps its sample
 * position toward that tile's centre. That single line is the frost -- glass homogenises
 * whatever sits behind it, and pulling every sample toward one point does exactly that
 * without a second pass or a backdrop-filter. The rounded-rect SDF that defines the tile
 * then gives us the 1px rim and, for free, the little concave diamonds where four corner
 * radii meet. That lattice is the whole illusion: the tiles butt edge to edge.
 */

export type LiquidGlassFieldProps = {
  className?: string;
  gridN?: number;
  /** Corner radius in tile units. The reference is 10px on a 50px tile. */
  tileRadius?: number;
  frost?: number;
  lens?: number;
  /** Chromatic dispersion at the tile rim. 0 turns the extra marches off entirely. */
  chroma?: number;
  rim?: number;
  gridShift?: number;
  /** Draw the glass lattice. Off gives the bare wave field -- used by /test. */
  lattice?: boolean;
  /** Camera + palette tuning; see lib/fieldTuning. */
  zoom?: number;
  tilt?: number;
  amplitude?: number;
  height?: number;
  fogDepth?: number;
  brightness?: number;
  /** 0 fills the zone, 1 masks the field into a centred sphere. */
  globe?: number;
  /** Depth-to-colour sensitivity. Higher packs more visible shells into the mass. */
  band?: number;
  speed?: number;
  waveScale?: number;
  waveRatio?: number;
  swell?: number;
  turbulence?: number;
  opacity?: number;
  grain?: boolean;
  grainIntensity?: number;
  /** Pointer-driven camera swing. Scales up with hover. */
  parallax?: number;
  horizonColor?: string;
  waveColor?: string;
  crestColor?: string;
  detail?: 'low' | 'medium' | 'high';
  paused?: boolean;
  /**
   * Called every frame with the *smoothed* values. Used to drive things that must
   * stay in lockstep with the liquid -- notably the readout flipping to white as the
   * waterline passes under it. Write to the DOM here; never setState.
   */
  onSample?: (s: Readonly<FieldTargets>) => void;
};

const LiquidGlassField = forwardRef<FieldHandle, LiquidGlassFieldProps>(function LiquidGlassField(
  {
    className = '',
    gridN = 6,
    tileRadius = 0.2,
    frost = 0.82,
    lens = 0.055,
    chroma = 0.022,
    rim = 0.55,
    gridShift = 0.006,
    lattice = true,
    zoom = 0.85,
    tilt = 0.12,
    amplitude = 4.2,
    height = 0.5,
    fogDepth = 60,
    brightness = 1.06,
    globe = 0,
    band = 0.08,
    speed = 0.65,
    waveScale = 0.6,
    waveRatio = 0.3,
    swell = 35,
    turbulence = 45,
    opacity = 1,
    grain = true,
    grainIntensity = 0.022,
    parallax = 1.6,
    horizonColor = CALM.horizon,
    waveColor = CALM.wave,
    crestColor = CALM.crest,
    detail = 'low',
    paused = false,
    onSample
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const target = useRef<FieldTargets>({ fill: 0, tint: 0, hover: 0, drag: 0, engage: 0, spread: 0 });
  const current = useRef<FieldTargets>({ fill: 0, tint: 0, hover: 0, drag: 0, engage: 0, spread: 0 });
  const pausedRef = useRef(paused);
  const sampleRef = useRef(onSample);
  const seekRef = useRef({ x: 0.5, y: 0.5 });
  const drawRef = useRef<(() => void) | null>(null);
  const uRef = useRef<Record<string, { value: number | Float32Array }> | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      set(next) {
        Object.assign(target.current, next);
      },
      snap(next) {
        Object.assign(target.current, next);
        Object.assign(current.current, next);
      },
      setPointer(x, y) {
        seekRef.current.x = x;
        seekRef.current.y = y;
      },
      draw() {
        drawRef.current?.();
      }
    }),
    []
  );

  useEffect(() => {
    pausedRef.current = paused;
    sampleRef.current = onSample;
  }, [paused, onSample]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new Renderer({
      webgl: 2,
      alpha: false,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    });
    const gl = renderer.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    host.appendChild(canvas);

    const a = { h: hexToRgb(CALM.horizon), w: hexToRgb(CALM.wave), c: hexToRgb(CALM.crest) };
    const b = { h: hexToRgb(ALARM.horizon), w: hexToRgb(ALARM.wave), c: hexToRgb(ALARM.crest) };

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },

        uSpeed: { value: 0.65 },
        uAmplitude: { value: amplitude },
        uWaveScale: { value: 0.6 },
        uWaveRatio: { value: 0.3 },
        uSwell: { value: 35 },
        uTurbulence: { value: 45 },
        uTilt: { value: tilt },
        uZoom: { value: zoom },
        uHeight: { value: height },
        uFogDepth: { value: fogDepth },
        uSteps: { value: STEPS[detail] },
        uBrightness: { value: brightness },
        uOpacity: { value: 1.0 },
        uGrain: { value: 1 },
        uGrainIntensity: { value: 0.022 },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uParallax: { value: 1 },

        uHorizonA: { value: new Float32Array(a.h) },
        uWaveA: { value: new Float32Array(a.w) },
        uCrestA: { value: new Float32Array(a.c) },
        uHorizonB: { value: new Float32Array(b.h) },
        uWaveB: { value: new Float32Array(b.w) },
        uCrestB: { value: new Float32Array(b.c) },
        uTint: { value: 0 },

        uGridN: { value: gridN },
        uTileRadius: { value: tileRadius },
        uFrost: { value: frost },
        uLens: { value: lens },
        uChroma: { value: chroma },
        uRim: { value: rim },
        uGridShift: { value: gridShift },
        uLattice: { value: lattice ? 1 : 0 },
        uGlobe: { value: globe },
        uBand: { value: band },

        uFill: { value: 0 },
        uHover: { value: 0 },
        uDrag: { value: 0 }
      }
    });

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    const u = program.uniforms as Record<string, { value: number | Float32Array }>;
    uRef.current = u;

    const setSize = () => {
      const r = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)));
      const res = u.iResolution.value as Float32Array;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
      renderer.render({ scene: mesh });
    };
    // One frame, on demand. It advances the smoothing by a step like the loop does,
    // so a caller driving this by hand still gets the ramp rather than a frozen value.
    drawRef.current = () => {
      const m = u.uMouse.value as Float32Array;
      m[0] += (seekRef.current.x - m[0]) * 0.35;
      m[1] += (seekRef.current.y - m[1]) * 0.35;

      (Object.keys(EASE) as (keyof FieldTargets)[]).forEach(k => {
        current.current[k] += (target.current[k] - current.current[k]) * EASE[k] * 2.5;
      });
      (u.uFill as { value: number }).value = current.current.fill;
      (u.uTint as { value: number }).value = current.current.tint;
      (u.uHover as { value: number }).value = current.current.hover;
      (u.uDrag as { value: number }).value = current.current.drag;
      renderer.render({ scene: mesh });
    };

    const ro = new ResizeObserver(setSize);
    ro.observe(host);
    setSize();

    const mouse = { x: 0.5, y: 0.5 };
    const seek = seekRef.current;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    let raf = 0;
    let visible = true;
    let pageVisible = !document.hidden;
    const t0 = performance.now();
    let last = t0;

    const loop = (now: number) => {
      // Frame-rate independent smoothing, clamped so a long tab-switch stall does
      // not teleport every value on the first frame back.
      const dt = Math.min((now - last) / 16.6667, 3);
      last = now;

      if (!pausedRef.current && !reduce.matches) {
        (u.iTime as { value: number }).value = (now - t0) * 0.001;
      }

      mouse.x += (seek.x - mouse.x) * Math.min(1, 0.08 * dt);
      mouse.y += (seek.y - mouse.y) * Math.min(1, 0.08 * dt);
      const m = u.uMouse.value as Float32Array;
      m[0] = mouse.x;
      m[1] = mouse.y;

      (Object.keys(EASE) as (keyof FieldTargets)[]).forEach(k => {
        const k2 = Math.min(1, EASE[k] * dt);
        current.current[k] += (target.current[k] - current.current[k]) * k2;
      });
      (u.uFill as { value: number }).value = current.current.fill;
      (u.uTint as { value: number }).value = current.current.tint;
      (u.uHover as { value: number }).value = current.current.hover;
      (u.uDrag as { value: number }).value = current.current.drag;

      sampleRef.current?.(current.current);

      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (visible && pageVisible && raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const stop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0 }
    );
    io.observe(host);

    const onVis = () => {
      pageVisible = !document.hidden;
      if (pageVisible) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVis);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      try {
        host.removeChild(canvas);
      } catch {
        /* already detached */
      }
      drawRef.current = null;
      uRef.current = null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // Built once. Every tunable below is a uniform, synced by the effect that follows,
    // so moving a dial never tears down the context or recompiles the shader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const u = uRef.current;
    if (!u) return;
    const num = (k: string, v: number) => {
      (u[k] as { value: number }).value = v;
    };
    const col = (k: string, hex: string) => {
      const t = u[k].value as Float32Array;
      const [r, g, b] = hexToRgb(hex);
      t[0] = r;
      t[1] = g;
      t[2] = b;
    };

    num('uGridN', gridN);
    num('uTileRadius', tileRadius);
    num('uFrost', frost);
    num('uLens', lens);
    num('uChroma', chroma);
    num('uRim', rim);
    num('uGridShift', gridShift);
    num('uLattice', lattice ? 1 : 0);

    num('uZoom', zoom);
    num('uTilt', tilt);
    num('uAmplitude', amplitude);
    num('uHeight', height);
    num('uFogDepth', fogDepth);
    num('uBrightness', brightness);
    num('uGlobe', globe);
    num('uBand', band);
    num('uSpeed', speed);
    num('uWaveScale', waveScale);
    num('uWaveRatio', waveRatio);
    num('uSwell', swell);
    num('uTurbulence', turbulence);
    num('uOpacity', opacity);
    num('uGrain', grain ? 1 : 0);
    num('uGrainIntensity', grainIntensity);
    num('uParallax', parallax);
    num('uSteps', STEPS[detail]);

    col('uHorizonA', horizonColor);
    col('uWaveA', waveColor);
    col('uCrestA', crestColor);

    // Repaint immediately: the loop is paused whenever the document reports itself
    // hidden, and a dial that does nothing until you move the mouse is useless.
    drawRef.current?.();
  }, [
    gridN, tileRadius, frost, lens, chroma, rim, gridShift, lattice,
    zoom, tilt, amplitude, height, fogDepth, brightness, globe, band,
    speed, waveScale, waveRatio, swell, turbulence, opacity, grain, grainIntensity,
    parallax, detail, horizonColor, waveColor, crestColor
  ]);

  return <div ref={hostRef} className={`absolute inset-0 overflow-hidden ${className}`.trim()} />;
});

export default LiquidGlassField;
