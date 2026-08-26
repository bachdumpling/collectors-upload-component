/**
 * Pasted verbatim from the react liquid-glass component, with two changes:
 *   - `Glass` is exported (the original only default-exports GlassButton)
 *   - the unused GlassButton/cva bits are dropped, since /test only needs the surface
 *   - useDarkMode subscribes instead of setState-in-effect, to keep lint clean
 *   - `autoScale` added: every length in the presets (blur, distortionScale, the inset
 *     shadows) is absolute and written for a ~400px pane. Dropped onto a 49px tile they
 *     are 8x oversized -- the inner shadows cover the whole tile and the displacement
 *     samples several tile-widths away. autoScale rescales them by min(w,h)/400 so the
 *     comparison is against the component tuned for its actual size.
 * Kept here for the comparison bench at /test. Not used by the upload zone.
 */
import React, { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

const useDarkMode = (): boolean =>
  useSyncExternalStore(
    cb => {
      const mq = darkQuery();
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => darkQuery().matches,
    () => false
  );

const GLASS_PRESETS = {
  subtle: { backgroundOpacity: 0.06, saturation: 1.1, brightness: 55, blur: 8, displace: 0.3, distortionScale: -80, redOffset: -2, greenOffset: 6, blueOffset: 12, mixBlendMode: 'difference' },
  default: { backgroundOpacity: 0.1, saturation: 1.4, brightness: 55, blur: 10, displace: 0.5, distortionScale: -160, redOffset: 0, greenOffset: 8, blueOffset: 16, mixBlendMode: 'difference' },
  bold: { backgroundOpacity: 0.18, saturation: 1.8, brightness: 60, blur: 12, displace: 0.8, distortionScale: -240, redOffset: 6, greenOffset: 12, blueOffset: 24, mixBlendMode: 'screen' },
  ghost: { backgroundOpacity: 0, saturation: 1, brightness: 55, blur: 6, displace: 0, distortionScale: 0, redOffset: 0, greenOffset: 0, blueOffset: 0, mixBlendMode: 'difference' }
};

export type GlassVariant = keyof typeof GLASS_PRESETS;

const GLASS_DEFAULTS = {
  width: 'auto' as number | string,
  height: 'auto' as number | string,
  borderRadius: 20,
  borderWidth: 0.07,
  opacity: 0.93,
  xChannel: 'R' as const,
  yChannel: 'G' as const
};

export interface GlassProps {
  variant?: GlassVariant;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  borderWidth?: number;
  brightness?: number;
  opacity?: number;
  blur?: number;
  displace?: number;
  backgroundOpacity?: number;
  saturation?: number;
  distortionScale?: number;
  redOffset?: number;
  greenOffset?: number;
  blueOffset?: number;
  xChannel?: 'R' | 'G' | 'B' | 'A';
  yChannel?: 'R' | 'G' | 'B' | 'A';
  mixBlendMode?: string;
  /** Rescale the preset's absolute lengths to this element's size. */
  autoScale?: boolean;
  /** Multiplier on the two inset shadows. They are painted unconditionally, so over an
   *  empty zone they are the entire reason the tile is visible at all. */
  shadowStrength?: number;
}

/** The pane size the presets were authored against. */
const REFERENCE_SIZE = 400;

export const Glass: React.FC<GlassProps> = rawProps => {
  const { variant = 'default', children, className = '', style = {}, autoScale = false, shadowStrength = 1 } = rawProps;
  const [measured, setMeasured] = useState(0);
  const k = autoScale && measured > 0 ? measured / REFERENCE_SIZE : 1;

  const uniqueId = useId().replace(/:/g, '-');
  const filterId = `glass-filter-${uniqueId}`;
  const redGradId = `red-grad-${uniqueId}`;
  const blueGradId = `blue-grad-${uniqueId}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const feImageRef = useRef<SVGFEImageElement>(null);
  const redChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const greenChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const blueChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const gaussianBlurRef = useRef<SVGFEGaussianBlurElement>(null);

  const isDarkMode = useDarkMode();

  const v = useMemo(() => {
    const p = GLASS_PRESETS[variant] ?? GLASS_PRESETS.default;
    const over = rawProps as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...GLASS_DEFAULTS, ...p };
    for (const k of Object.keys(GLASS_DEFAULTS).concat(Object.keys(p))) {
      if (over[k] !== undefined) merged[k] = over[k];
    }
    return merged as typeof GLASS_DEFAULTS & (typeof GLASS_PRESETS)['default'];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, JSON.stringify(rawProps)]);

  const generateDisplacementMap = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 400;
    const h = rect?.height || 200;
    const edge = Math.min(w, h) * (v.borderWidth * 0.5);
    const blurPx = v.blur * k;
    const svg = `
      <svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${w}" height="${h}" fill="black"></rect>
        <rect x="0" y="0" width="${w}" height="${h}" rx="${v.borderRadius}" fill="url(#${redGradId})" />
        <rect x="0" y="0" width="${w}" height="${h}" rx="${v.borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: ${v.mixBlendMode}" />
        <rect x="${edge}" y="${edge}" width="${w - edge * 2}" height="${h - edge * 2}" rx="${v.borderRadius}" fill="hsl(0 0% ${v.brightness}% / ${v.opacity})" style="filter:blur(${blurPx}px)" />
      </svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };

  const updateDisplacementMap = () => {
    feImageRef.current?.setAttribute('href', generateDisplacementMap());
  };

  useEffect(() => {
    updateDisplacementMap();
    [
      { ref: redChannelRef, offset: v.redOffset },
      { ref: greenChannelRef, offset: v.greenOffset },
      { ref: blueChannelRef, offset: v.blueOffset }
    ].forEach(({ ref, offset }) => {
      ref.current?.setAttribute('scale', ((v.distortionScale + offset) * k).toString());
      ref.current?.setAttribute('xChannelSelector', v.xChannel);
      ref.current?.setAttribute('yChannelSelector', v.yChannel);
    });
    gaussianBlurRef.current?.setAttribute('stdDeviation', (v.displace * k).toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, k]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured(Math.min(r.width, r.height));
      setTimeout(updateDisplacementMap, 0);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [svgFilterSupported, setSvgFilterSupported] = useState(true);
  const [backdropFilterSupported, setBackdropFilterSupported] = useState(true);

  useEffect(() => {
    const isWebkit = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const isFirefox = /Firefox/.test(navigator.userAgent);
    setSvgFilterSupported(!isWebkit && !isFirefox);
    setBackdropFilterSupported(CSS.supports('backdrop-filter', 'blur(10px)'));
  }, [filterId]);

  const containerStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      ...style,
      width: typeof v.width === 'number' ? `${v.width}px` : v.width,
      height: typeof v.height === 'number' ? `${v.height}px` : v.height,
      borderRadius: `${v.borderRadius}px`
    };
    if (svgFilterSupported) {
      return {
        ...base,
        background: isDarkMode ? `hsl(0 0% 0% / ${v.backgroundOpacity})` : `hsl(0 0% 100% / ${v.backgroundOpacity})`,
        backdropFilter: `url(#${filterId}) saturate(${v.saturation})`,
        // Scaled with the element: at 400px these are the original 2/1 and 10/4.
        boxShadow: `0 0 ${2 * k}px ${1 * k}px color-mix(in oklch, black, transparent ${100 - 15 * shadowStrength}%) inset,
                    0 0 ${10 * k}px ${4 * k}px color-mix(in oklch, black, transparent ${100 - 10 * shadowStrength}%) inset`
      };
    }
    if (!backdropFilterSupported) {
      return { ...base, background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.3)' };
    }
    return {
      ...base,
      background: 'rgba(255,255,255,0.25)',
      backdropFilter: 'blur(12px) saturate(1.8) brightness(1.1)',
      WebkitBackdropFilter: 'blur(12px) saturate(1.8) brightness(1.1)',
      border: '1px solid rgba(255,255,255,0.3)'
    };
  };

  return (
    <div
      ref={containerRef}
      data-svg-filter={svgFilterSupported ? 'on' : 'off'}
      className={cn('relative flex items-center justify-center overflow-hidden', className)}
      style={containerStyles()}
    >
      <svg className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
            <feImage ref={feImageRef} href={generateDisplacementMap()} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
            <feDisplacementMap ref={redChannelRef} in="SourceGraphic" in2="map" result="dispRed" />
            <feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
            <feDisplacementMap ref={greenChannelRef} in="SourceGraphic" in2="map" result="dispGreen" />
            <feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
            <feDisplacementMap ref={blueChannelRef} in="SourceGraphic" in2="map" result="dispBlue" />
            <feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="output" />
            <feGaussianBlur ref={gaussianBlurRef} in="output" stdDeviation="0.7" />
          </filter>
        </defs>
      </svg>
      <div className="relative z-10 flex h-full w-full items-center justify-center rounded-[inherit]">{children}</div>
    </div>
  );
};

export default Glass;
