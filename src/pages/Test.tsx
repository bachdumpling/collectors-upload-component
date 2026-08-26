import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import LiquidGlassField from '@/components/LiquidGlassField';
import { type FieldHandle } from '@/lib/waveField';
import { Glass, type GlassVariant } from '@/components/liquid-glass';
import { TUNING, type FieldTuning } from '@/lib/fieldTuning';

// three + fiber + drei is ~600kB; kept out of the main chunk.
const TransmissionLattice = lazy(() => import('@/pages/TransmissionLattice'));
type TileShape = 'rounded' | 'cube' | 'lens';

/** WebGL2/three can fail outright on some machines; don't take the page down with it. */
class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { err: e.message };
  }
  render() {
    if (this.state.err) {
      return <div className="grid h-full w-full place-items-center bg-white p-4 text-center text-[12px] text-[var(--alarm)]">{this.state.err}</div>;
    }
    return this.props.children;
  }
}

// The Figma frame is 294px with 48.71px tiles, so the reference sits at native
// resolution and the live tiles line up 1:1 with it.
const SIZE = 294;
const N = 6;
const TILE = SIZE / N;

function Pane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="m-0">
      <div className="relative isolate overflow-hidden rounded-[14px] ring-1 ring-black/10" style={{ width: SIZE, height: SIZE }}>
        {children}
      </div>
      <figcaption className="mt-2 text-[11.5px] text-[var(--mute)]">{label}</figcaption>
    </figure>
  );
}

/**
 * Pointer parallax is the whole reason `parallax` has a dial, so every pane has to be
 * hoverable. Drawing on the move keeps it responsive even where the loop is throttled.
 */
function usePointerTrack(field: React.RefObject<FieldHandle | null>) {
  return {
    onPointerMove: (e: React.PointerEvent) => {
      const r = e.currentTarget.getBoundingClientRect();
      field.current?.setPointer((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
      field.current?.set({ hover: 1 });
      field.current?.draw();
    },
    onPointerLeave: () => {
      field.current?.setPointer(0.5, 0.5);
      field.current?.set({ hover: 0 });
      field.current?.draw();
    }
  };
}

function ShaderLattice({ fill, tuning }: { fill: number; tuning: FieldTuning }) {
  const field = useRef<FieldHandle>(null);
  useEffect(() => {
    field.current?.snap({ fill });
    field.current?.draw();
  }, [fill, tuning]);

  return (
    <>
      <LiquidGlassField ref={field} {...tuning} />
      <div className="absolute inset-0 z-20" {...usePointerTrack(field)} />
    </>
  );
}

function SvgGlassLattice({
  variant,
  fill,
  shadowStrength,
  tuning
}: {
  variant: GlassVariant;
  fill: number;
  shadowStrength: number;
  tuning: FieldTuning;
}) {
  const field = useRef<FieldHandle>(null);
  useEffect(() => {
    field.current?.snap({ fill });
    field.current?.draw();
  }, [fill, tuning]);
  return (
    <>
      <LiquidGlassField ref={field} lattice={false} {...tuning} />
      <div
        className="absolute inset-0 z-10 grid"
        style={{ gridTemplateColumns: `repeat(${N}, ${TILE}px)`, gridTemplateRows: `repeat(${N}, ${TILE}px)` }}
      >
        {Array.from({ length: N * N }, (_, i) => (
          <Glass key={i} variant={variant} width={TILE} height={TILE} borderRadius={10} autoScale={false} shadowStrength={shadowStrength} />
        ))}
      </div>
      <div className="absolute inset-0 z-20" {...usePointerTrack(field)} />
    </>
  );
}

type Mode = 'all' | 'shader' | 'svg' | 'r3f';

const field = 'flex items-center gap-2 text-[12px]';
const control = 'rounded-md border border-black/15 bg-white px-2 py-1';

function Dial({
  label,
  value,
  onChange,
  min,
  max,
  step
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-[var(--mute)]">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-[86px] accent-[var(--azure)]" />
      <span className="w-9 tabular-nums">{value}</span>
    </label>
  );
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-[var(--mute)]">
      {label}
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-[22px] w-[30px] cursor-pointer rounded border border-black/15 bg-white p-0"
      />
      <span className="w-[58px] tabular-nums">{value}</span>
    </label>
  );
}

export default function Test() {
  const [fill, setFill] = useState(1);
  const [bg, setBg] = useState<'field' | 'globe'>('globe');
  const [variant, setVariant] = useState<GlassVariant>('default');
  const [mode, setMode] = useState<Mode>('all');
  const [glassShadows, setGlassShadows] = useState(false);
  const [shape, setShape] = useState<TileShape>('cube');

  const [ior, setIor] = useState(1.3);
  const [thickness, setThickness] = useState(2);
  const [chroma, setChroma] = useState(0.4);
  const [roughness, setRoughness] = useState(0.5);

  // Start from the preset, then let the dials take over.
  const [tuning, setTuning] = useState<FieldTuning>(TUNING.globe);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setTuning(TUNING[bg]);
  }, [bg]);
  const set = (k: keyof FieldTuning) => (v: number) => setTuning(t => ({ ...t, [k]: v }));
  const setColor = (k: keyof FieldTuning) => (v: string) => setTuning(t => ({ ...t, [k]: v }));

  return (
    <main className="min-h-dvh px-8 py-8">
      <div className="mx-auto flex max-w-[1340px] flex-wrap items-center gap-x-6 gap-y-3">
        <Dial label="Fill" value={fill} onChange={setFill} min={0} max={1} step={0.01} />

        <label className={field}>
          <select value={bg} onChange={e => setBg(e.target.value as 'field' | 'globe')} className={control}>
            <option value="globe">globe</option>
            <option value="field">field</option>
          </select>
        </label>

        <label className={field}>
          <select value={variant} onChange={e => setVariant(e.target.value as GlassVariant)} className={control}>
            {(['subtle', 'default', 'bold', 'ghost'] as GlassVariant[]).map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>

        <label className={field}>
          <select value={mode} onChange={e => setMode(e.target.value as Mode)} className={control}>
            <option value="all">all</option>
            <option value="shader">shader only</option>
            <option value="svg">svg only</option>
            <option value="r3f">transmission only</option>
          </select>
        </label>

        <label className={field}>
          <input type="checkbox" checked={glassShadows} onChange={e => setGlassShadows(e.target.checked)} className="size-[13px] accent-[var(--azure)]" />
          svg: inset shadows
        </label>
      </div>

      <div className="mx-auto mt-6 flex max-w-[1340px] flex-wrap gap-6">
        <Pane label="Figma">
          <img src="/figma-uploaded.png" alt="" className="absolute inset-0 h-full w-full" />
        </Pane>

        {(mode === 'all' || mode === 'shader') && (
          <Pane label="Shader">
            <ShaderLattice fill={fill} tuning={tuning} />
          </Pane>
        )}

        {(mode === 'all' || mode === 'svg') && (
          <Pane label="SVG Glass">
            <SvgGlassLattice variant={variant} fill={fill} shadowStrength={glassShadows ? 1 : 0} tuning={tuning} />
          </Pane>
        )}

        {(mode === 'all' || mode === 'r3f') && (
          <Pane label="Transmission">
            <Boundary>
              <Suspense fallback={<div className="h-full w-full bg-white" />}>
                <TransmissionLattice size={SIZE} fill={fill} ior={ior} thickness={thickness} chroma={chroma} roughness={roughness} shape={shape} tuning={tuning} samples={32} />
              </Suspense>
            </Boundary>
          </Pane>
        )}
      </div>

      <div className="mx-auto mt-7 flex max-w-[1340px] flex-wrap items-center gap-x-5 gap-y-2">
        <Swatch label="horizon" value={tuning.horizonColor} onChange={setColor('horizonColor')} />
        <Swatch label="wave" value={tuning.waveColor} onChange={setColor('waveColor')} />
        <Swatch label="crest" value={tuning.crestColor} onChange={setColor('crestColor')} />
        <Dial label="bright" value={tuning.brightness} onChange={set('brightness')} min={0.5} max={2.2} step={0.01} />
        <Dial label="opacity" value={tuning.opacity} onChange={set('opacity')} min={0} max={1} step={0.01} />
        <Dial label="fog" value={tuning.fogDepth} onChange={set('fogDepth')} min={5} max={90} step={1} />
        <Dial label="shells" value={tuning.band} onChange={set('band')} min={0.01} max={0.6} step={0.005} />
      </div>

      <div className="mx-auto mt-2.5 flex max-w-[1340px] flex-wrap items-center gap-x-5 gap-y-2">
        <Dial label="zoom" value={tuning.zoom} onChange={set('zoom')} min={0.2} max={1.6} step={0.01} />
        <Dial label="tilt" value={tuning.tilt} onChange={set('tilt')} min={0} max={1.2} step={0.01} />
        <Dial label="height" value={tuning.height} onChange={set('height')} min={-8} max={14} step={0.5} />
        <Dial label="orb" value={tuning.globe} onChange={set('globe')} min={0} max={1} step={0.05} />
        <Dial label="parallax" value={tuning.parallax} onChange={set('parallax')} min={0} max={4} step={0.05} />
        <Dial label="grain" value={tuning.grainIntensity} onChange={set('grainIntensity')} min={0} max={0.12} step={0.002} />
      </div>

      <div className="mx-auto mt-2.5 flex max-w-[1340px] flex-wrap items-center gap-x-5 gap-y-2">
        <Dial label="amplitude" value={tuning.amplitude} onChange={set('amplitude')} min={0.5} max={14} step={0.1} />
        <Dial label="scale" value={tuning.waveScale} onChange={set('waveScale')} min={0.05} max={2} step={0.01} />
        <Dial label="ratio" value={tuning.waveRatio} onChange={set('waveRatio')} min={0.05} max={2} step={0.01} />
        <Dial label="swell" value={tuning.swell} onChange={set('swell')} min={0} max={80} step={1} />
        <Dial label="turbulence" value={tuning.turbulence} onChange={set('turbulence')} min={0} max={80} step={1} />
        <Dial label="speed" value={tuning.speed} onChange={set('speed')} min={0} max={2.5} step={0.01} />
      </div>

      <div className="mx-auto mt-2.5 flex max-w-[1340px] flex-wrap items-center gap-x-5 gap-y-2">
        <label className={field}>
          <select value={shape} onChange={e => setShape(e.target.value as TileShape)} className={control}>
            <option value="cube">cube.glb</option>
            <option value="lens">lens.glb</option>
            <option value="rounded">rounded box</option>
          </select>
        </label>
        <Dial label="IOR" value={ior} onChange={setIor} min={1} max={2.4} step={0.01} />
        <Dial label="thickness" value={thickness} onChange={setThickness} min={0} max={30} step={0.5} />
        <Dial label="chromatic" value={chroma} onChange={setChroma} min={0} max={1} step={0.01} />
        <Dial label="roughness" value={roughness} onChange={setRoughness} min={0} max={0.6} step={0.01} />
      </div>
    </main>
  );
}
