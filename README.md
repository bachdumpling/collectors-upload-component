# Drop an image

A drag-and-drop image upload zone. Thirty-six glass cubes refracting a live wave field.

```bash
pnpm install && pnpm dev
```

Vite, React 19, TypeScript, Tailwind v4, three.js and Motion. The wave field is forked from
[react-bits](https://reactbits.dev) `GradientWaves`. The glass cube is FluidGlass's mesh.

`/` is the component. `/test` is the bench I built to choose it.

---

## How it's put together

One WebGL canvas, two passes. The wave field renders to an off-screen buffer, and thirty-six cubes
refract that buffer. All of them share the one buffer, which is what makes thirty-six of them
affordable: without it, each transmission material re-renders the scene for itself, thirty-six
times a frame.

There are five states: `idle`, `over`, `uploading`, `success` and `error`. Everything they change
is a smoothed target (level, tint, hover, camera pull-in, and how tightly the mass gathers), so
nothing cuts hard between them, and pointer parallax runs through all five.

| | |
| --- | --- |
| `src/components/TransmissionField.tsx` | What ships. FBO, the cube lattice, the smoothing loop. |
| `src/components/UploadZone.tsx` | Drag and drop, the surfacing sequence, the readout. |
| `src/hooks/useUpload.ts` | State machine and the simulated upload. |
| `src/lib/waveField.ts` | The shader, the shared types, the palettes. Imports no WebGL library, which is what keeps OGL out of the chunk `/` ships. |
| `src/components/LiquidGlassField.tsx` | The shader-lattice glass. Bench only, via OGL. |
| `src/components/liquid-glass.tsx` | The SVG-filter glass. Bench only. |
| `src/pages/Test.tsx` | The bench. |
| `public/assets/3d/*.glb` | cube and lens meshes from [react-bits](https://github.com/DavidHDev/react-bits/tree/main/public/assets/3d) (MIT). 30 kB. |

`/` is 363 kB gzipped, most of it three.js. The bench and its OGL renderer are a separate 28 kB
chunk that `/` never loads.

Reduced motion stops the wave clock, so you get a still field rather than a slower one. It also
collapses the CSS transitions and cross-fades the uploaded image in place instead of rising it.

The toggle makes the next upload fail partway, so the error state can be seen without hunting for a
broken connection. Dropping anything over 8 MB shows it too.
