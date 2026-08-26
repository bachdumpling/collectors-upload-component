import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, createPortal, useFrame, useThree, type RootState } from '@react-three/fiber';
import { MeshTransmissionMaterial, useFBO, useGLTF } from '@react-three/drei';
import { ALARM, CALM, EASE, fragment, type FieldHandle, type FieldTargets } from '@/lib/waveField';

/**
 * The glass lattice as real geometry: the wave field is rendered to an off-screen
 * buffer and 36 FluidGlass cubes refract it through MeshTransmissionMaterial — actual
 * IOR, thickness and chromatic dispersion rather than a shader approximation.
 *
 * Passing `buffer` to every tile is what makes 36 of them affordable; without it each
 * transmission material re-renders the scene for itself, once per tile.
 *
 * Same imperative handle as LiquidGlassField, so the zone can swap between them.
 */

const GLB = '/assets/3d/cube.glb';
useGLTF.preload(GLB);

const N = 6;
const FRAG = fragment.replace('#version 300 es', '').trimStart();
const VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** The camera pulls in as the pointer arrives, so the zone opens up under the cursor. */
const ZOOM = { rest: 0.29, engaged: 0.6 };

/** How tightly the radial mask gathers the mass when `spread` is 0. */
const GLOBE = 0.7;

type Shared = {
  target: FieldTargets;
  current: FieldTargets;
  pointer: { x: number; y: number };
  onSample?: (s: Readonly<FieldTargets>) => void;
};

/** Checked once per mount: the field's motion is ambient, so someone who has asked for
 *  less of it should get a still image, not a slower one. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function WaveScene({ shared }: { shared: React.RefObject<Shared> }) {
  const mat = useRef<THREE.RawShaderMaterial>(null!);
  const [still] = useState(prefersReducedMotion);
  const uniforms = useMemo(
    () => ({
      iResolution: { value: new THREE.Vector2(1, 1) },
      iTime: { value: 0 },
      uSpeed: { value: 0.65 },
      uAmplitude: { value: 4.6 },
      uWaveScale: { value: 0.6 },
      uWaveRatio: { value: 0.3 },
      uSwell: { value: 35 },
      uTurbulence: { value: 45 },
      uTilt: { value: 0.49 },
      uZoom: { value: ZOOM.rest },
      uHeight: { value: 1.5 },
      uFogDepth: { value: 56 },
      uSteps: { value: 40 },
      uBrightness: { value: 1 },
      uOpacity: { value: 1 },
      uGrain: { value: 1 },
      uGrainIntensity: { value: 0.022 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uParallax: { value: 1.6 },
      uHorizonA: { value: new THREE.Color(CALM.horizon) },
      uWaveA: { value: new THREE.Color(CALM.wave) },
      uCrestA: { value: new THREE.Color(CALM.crest) },
      uHorizonB: { value: new THREE.Color(ALARM.horizon) },
      uWaveB: { value: new THREE.Color(ALARM.wave) },
      uCrestB: { value: new THREE.Color(ALARM.crest) },
      uTint: { value: 0 },
      uGridN: { value: N },
      uTileRadius: { value: 0.2 },
      // The glass is geometry here, so the shader's own lattice stays off.
      uFrost: { value: 0 },
      uLens: { value: 0 },
      uChroma: { value: 0 },
      uRim: { value: 0 },
      uGridShift: { value: 0 },
      uLattice: { value: 0 },
      uGlobe: { value: GLOBE },
      uBand: { value: 0.185 },
      uFill: { value: 0 },
      uHover: { value: 0 },
      uDrag: { value: 0 }
    }),
    []
  );

  const { size } = useThree();
  useEffect(() => {
    (uniforms.iResolution.value as THREE.Vector2).set(size.width, size.height);
  }, [size, uniforms]);

  useFrame(({ clock }) => {
    const s = shared.current;
    const u = mat.current?.uniforms;
    if (!s || !u) return;

    (Object.keys(EASE) as (keyof FieldTargets)[]).forEach(k => {
      s.current[k] += (s.target[k] - s.current[k]) * EASE[k];
    });

    const m = u.uMouse.value as THREE.Vector2;
    m.x += (s.pointer.x - m.x) * 0.07;
    m.y += (s.pointer.y - m.y) * 0.07;

    const engaged = Math.max(s.current.hover, s.current.drag, s.current.engage);
    u.uZoom.value = ZOOM.rest + (ZOOM.engaged - ZOOM.rest) * engaged;

    // Spread releases the radial mask, so the globe opens out into a full field while
    // the upload runs and gathers back afterwards.
    u.uGlobe.value = GLOBE * (1 - s.current.spread);

    if (!still) u.iTime.value = clock.elapsedTime;
    u.uFill.value = s.current.fill;
    u.uTint.value = s.current.tint;
    u.uHover.value = s.current.hover;
    u.uDrag.value = s.current.drag;

    s.onSample?.(s.current);
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <rawShaderMaterial
        ref={mat}
        glslVersion={THREE.GLSL3}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function Lattice({ shared }: { shared: React.RefObject<Shared> }) {
  const { size, camera, gl } = useThree();
  const buffer = useFBO(Math.max(1, size.width), Math.max(1, size.height));
  const [offscreen] = useState(() => new THREE.Scene());
  const { nodes } = useGLTF(GLB);
  const tile = size.width / N;

  const geo = useMemo(() => {
    const g = (nodes.Cube as THREE.Mesh | undefined)?.geometry;
    if (!g) return null;
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
    return { geometry: g, scale: tile / span };
  }, [nodes, tile]);

  useFrame(() => {
    gl.setRenderTarget(buffer);
    gl.render(offscreen, camera);
    gl.setRenderTarget(null);
  });

  return (
    <>
      {createPortal(<WaveScene shared={shared} />, offscreen)}

      {/* the field itself, seen through the gaps between tiles */}
      <mesh position={[0, 0, -1]}>
        <planeGeometry args={[size.width, size.height]} />
        <meshBasicMaterial map={buffer.texture} toneMapped={false} />
      </mesh>

      {geo &&
        Array.from({ length: N * N }, (_, i) => {
          const col = i % N;
          const row = Math.floor(i / N);
          return (
            <mesh
              key={i}
              geometry={geo.geometry}
              scale={geo.scale}
              position={[(col - (N - 1) / 2) * tile, ((N - 1) / 2 - row) * tile, 0]}
            >
              <MeshTransmissionMaterial
                buffer={buffer.texture}
                samples={16}
                ior={1.3}
                thickness={2}
                chromaticAberration={0.4}
                roughness={0.5}
                anisotropy={0.02}
                distortion={0}
                transmission={1}
                backside={false}
                toneMapped={false}
                color="#ffffff"
                attenuationColor="#ffffff"
                attenuationDistance={1e6}
                envMapIntensity={0}
                reflectivity={0.12}
              />
            </mesh>
          );
        })}
    </>
  );
}

export type TransmissionFieldProps = {
  className?: string;
  onSample?: (s: Readonly<FieldTargets>) => void;
};

const TransmissionField = forwardRef<FieldHandle, TransmissionFieldProps>(function TransmissionField(
  { className = '', onSample },
  ref
) {
  const shared = useRef<Shared>({
    target: { fill: 0, tint: 0, hover: 0, drag: 0, engage: 0, spread: 0 },
    current: { fill: 0, tint: 0, hover: 0, drag: 0, engage: 0, spread: 0 },
    pointer: { x: 0.5, y: 0.5 },
    onSample
  });

  const api = useRef<RootState | null>(null);

  useEffect(() => {
    shared.current.onSample = onSample;
  }, [onSample]);

  useImperativeHandle(
    ref,
    () => ({
      set(next) {
        Object.assign(shared.current.target, next);
      },
      snap(next) {
        Object.assign(shared.current.target, next);
        Object.assign(shared.current.current, next);
      },
      setPointer(x, y) {
        shared.current.pointer.x = x;
        shared.current.pointer.y = y;
      },
      draw() {
        api.current?.advance(performance.now());
      }
    }),
    []
  );

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`.trim()}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 500 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        onCreated={state => {
          state.gl.setClearColor('#ffffff', 1);
          api.current = state;
        }}
      >
        <ambientLight intensity={1} />
        <Lattice shared={shared} />
      </Canvas>
    </div>
  );
});

export default TransmissionField;
