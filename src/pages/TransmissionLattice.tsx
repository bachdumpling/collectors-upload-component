import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, createPortal, useFrame, useThree, type RootState } from '@react-three/fiber';
import { MeshTransmissionMaterial, RoundedBox, useFBO, useGLTF } from '@react-three/drei';
import { fragment } from '@/lib/waveField';
import type { FieldTuning } from '@/lib/fieldTuning';

/**
 * The technique FluidGlass is built on, applied to our problem instead of its demo:
 * the wave field is rendered into an off-screen buffer, and a 6x6 grid of rounded
 * tiles refracts that buffer through MeshTransmissionMaterial -- real IOR, thickness
 * and chromatic aberration rather than an approximation.
 *
 * Passing `buffer` to every tile is what makes this affordable: without it each
 * transmission material renders the scene again for itself, once per tile.
 */

// three prepends its own #version for GLSL3, so the directive has to come off.
const FRAG = fragment.replace('#version 300 es', '').trimStart();

const VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const N = 6;

export type TileShape = 'rounded' | 'cube' | 'lens';

type Props = {
  size: number;
  fill: number;
  ior: number;
  thickness: number;
  chroma: number;
  roughness: number;
  shape: TileShape;
  tuning: FieldTuning;
  /** Blur taps behind `roughness`. Baked into the shader source at construction, so the
   *  material is keyed on it — changing it rebuilds the instance rather than doing nothing. */
  samples: number;
};

// The real FluidGlass assets. Its own geometry keys: lens is a Cylinder, cube a Cube.
const GLB = {
  cube: { url: '/assets/3d/cube.glb', key: 'Cube', rotX: 0 },
  lens: { url: '/assets/3d/lens.glb', key: 'Cylinder', rotX: Math.PI / 2 }
} as const;

useGLTF.preload(GLB.cube.url);
useGLTF.preload(GLB.lens.url);

/**
 * Loads a FluidGlass mesh and normalises it so its widest axis spans one tile.
 * Always loads something so the hook order stays stable across shape changes;
 * 'rounded' just discards the result.
 */
function useGlbTile(shape: TileShape, tile: number) {
  const key = shape === 'cube' || shape === 'lens' ? shape : 'cube';
  const { nodes } = useGLTF(GLB[key].url);
  return useMemo(() => {
    if (shape !== 'cube' && shape !== 'lens') return null;
    const geo = (nodes[GLB[key].key] as THREE.Mesh | undefined)?.geometry;
    if (!geo) return null;
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
    return { geometry: geo, scale: tile / span, rotX: GLB[key].rotX };
  }, [nodes, shape, key, tile]);
}

// A thick slab reads as a grey button over an empty zone: the bevelled sides catch
// shading and the attenuation darkens even a white backdrop. Glass over nothing has to
// disappear, so the tiles are kept thin and the lighting near-flat.
const DEPTH = 0.12;

type Pointer = { x: number; y: number; over: number };

function WavePlane({
  size,
  fill,
  tuning,
  pointer
}: {
  size: number;
  fill: number;
  tuning: FieldTuning;
  pointer: React.RefObject<Pointer>;
}) {
  const mat = useRef<THREE.RawShaderMaterial>(null!);

  const uniforms = useMemo(
    () => ({
      iResolution: { value: new THREE.Vector2(size, size) },
      iTime: { value: 0 },
      uSpeed: { value: tuning.speed },
      uAmplitude: { value: tuning.amplitude },
      uWaveScale: { value: tuning.waveScale },
      uWaveRatio: { value: tuning.waveRatio },
      uSwell: { value: tuning.swell },
      uTurbulence: { value: tuning.turbulence },
      uTilt: { value: tuning.tilt },
      uZoom: { value: tuning.zoom },
      uHeight: { value: tuning.height },
      uFogDepth: { value: tuning.fogDepth },
      uSteps: { value: 40 },
      uBrightness: { value: tuning.brightness },
      uOpacity: { value: tuning.opacity },
      uGrain: { value: 0 },
      uGrainIntensity: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uParallax: { value: tuning.parallax },
      uHorizonA: { value: new THREE.Color(tuning.horizonColor) },
      uWaveA: { value: new THREE.Color(tuning.waveColor) },
      uCrestA: { value: new THREE.Color(tuning.crestColor) },
      uHorizonB: { value: new THREE.Color('#8f0010') },
      uWaveB: { value: new THREE.Color('#f42a1e') },
      uCrestB: { value: new THREE.Color('#ff9d95') },
      uTint: { value: 0 },
      // The lattice is off: the glass here is geometry, not shader.
      uGridN: { value: N },
      uTileRadius: { value: 0.2 },
      uFrost: { value: 0 },
      uLens: { value: 0 },
      uChroma: { value: 0 },
      uRim: { value: 0 },
      uGridShift: { value: 0 },
      uLattice: { value: 0 },
      uGlobe: { value: tuning.globe },
      uBand: { value: tuning.band },
      uFill: { value: fill },
      uHover: { value: 0 },
      uDrag: { value: 0 }
    }),
    [size, fill, tuning]
  );

  useFrame(({ clock }) => {
    if (!mat.current) return;
    const u = mat.current.uniforms;
    u.uFill.value = fill;
    u.iTime.value = clock.elapsedTime;

    // Same smoothing the DOM field uses, so the two panes swing at the same rate.
    const m = u.uMouse.value as THREE.Vector2;
    m.x += (pointer.current.x - m.x) * 0.18;
    m.y += (pointer.current.y - m.y) * 0.18;
    u.uHover.value += (pointer.current.over - u.uHover.value) * 0.18;
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

function Scene({ size, fill, ior, thickness, chroma, roughness, shape = 'rounded', tuning, samples, pointer }: Props & { pointer: React.RefObject<Pointer> }) {
  const buffer = useFBO(size, size);
  const [offscreen] = useState(() => new THREE.Scene());
  const { camera } = useThree();
  const tile = size / N;
  const glb = useGlbTile(shape, tile);

  useFrame(({ gl }) => {
    gl.setRenderTarget(buffer);
    gl.render(offscreen, camera);
    gl.setRenderTarget(null);
  });

  return (
    <>
      {createPortal(<WavePlane size={size} fill={fill} tuning={tuning} pointer={pointer} />, offscreen)}

      {/* the field itself, visible through the gaps between tiles */}
      <mesh position={[0, 0, -1]}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial map={buffer.texture} toneMapped={false} />
      </mesh>

      {Array.from({ length: N * N }, (_, i) => {
        const col = i % N;
        const row = Math.floor(i / N);
        const pos: [number, number, number] = [(col - (N - 1) / 2) * tile, ((N - 1) / 2 - row) * tile, 0];

        if (glb && shape !== 'rounded') {
          return (
            <mesh key={i} geometry={glb.geometry} position={pos} scale={glb.scale} rotation-x={glb.rotX}>
              <MeshTransmissionMaterial
                key={samples}
                buffer={buffer.texture}
                ior={ior}
                thickness={thickness}
                chromaticAberration={chroma}
                roughness={roughness}
                samples={samples}
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
        }

        return (
          <RoundedBox
            key={i}
            args={[tile, tile, tile * DEPTH]}
            radius={tile * 0.11}
            smoothness={5}
            position={pos}
          >
            <MeshTransmissionMaterial
              key={samples}
              buffer={buffer.texture}
              ior={ior}
              thickness={thickness}
              chromaticAberration={chroma}
              roughness={roughness}
              samples={samples}
              anisotropy={0.02}
              distortion={0}
              transmission={1}
              backside={false}
              toneMapped={false}
              // Without these the slab tints whatever passes through it, so an empty
              // white zone comes out grey.
              color="#ffffff"
              attenuationColor="#ffffff"
              attenuationDistance={1e6}
              envMapIntensity={0}
              reflectivity={0.12}
            />
          </RoundedBox>
        );
      })}
    </>
  );
}

export default function TransmissionLattice(props: Props) {
  const api = useRef<RootState | null>(null);
  const pointer = useRef<Pointer>({ x: 0.5, y: 0.5, over: 0 });

  // The canvas has no DOM pointer plumbing of its own, so the wrapper does it and
  // nudges frames -- otherwise the parallax only moves when the loop happens to run.
  const step = () => {
    const t = performance.now();
    for (let i = 0; i < 3; i++) api.current?.advance(t + i * 16);
  };
  const onMove = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    pointer.current.x = (e.clientX - r.left) / r.width;
    pointer.current.y = 1 - (e.clientY - r.top) / r.height;
    pointer.current.over = 1;
    step();
  };
  const onLeave = () => {
    pointer.current.x = 0.5;
    pointer.current.y = 0.5;
    pointer.current.over = 0;
    step();
  };

  // The rAF loop stalls wherever the document reports itself hidden, which leaves the
  // canvas blank. Nudging a few frames on every prop change means the pane always shows
  // the current settings even when nothing is animating.
  useEffect(() => {
    const t = performance.now();
    for (let i = 0; i < 3; i++) api.current?.advance(t + i * 16);
  }, [props.size, props.fill, props.ior, props.thickness, props.chroma, props.roughness, props.shape, props.tuning, props.samples]);

  return (
    <div onPointerMove={onMove} onPointerLeave={onLeave} style={{ width: props.size, height: props.size }}>
    <Canvas
      orthographic
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 500 }}
      gl={{ antialias: true, alpha: false }}
      style={{ width: props.size, height: props.size }}
      onCreated={state => {
        state.gl.setClearColor('#ffffff', 1);
        api.current = state;
        state.advance(performance.now());
      }}
    >
      <ambientLight intensity={1} />
      <Scene {...props} pointer={pointer} />
    </Canvas>
    </div>
  );
}
