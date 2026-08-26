import { useCallback, useEffect, useRef, useState } from 'react';
import { useAnimate } from 'motion/react';
import GlassToggle from '@/components/GlassToggle';
import { type FieldHandle } from '@/lib/waveField';
import TransmissionField from '@/components/TransmissionField';
import { useUpload } from '@/hooks/useUpload';

/** How long the uploaded image rests at centre before it leaves. */
const HOLD_MS = 5_000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** There is nothing to drag on a phone, so the zone should not ask you to. */
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

/**
 * Waterline heights, 0..1. Idle sits high so the panel reads as whole rather than
 * clipped, but the upload gets the full travel -- a level that only moves the last
 * tenth is not a level anyone can see. It drops as the file lands, then climbs.
 */
const LEVEL = { idle: 0.88, hover: 0.94, over: 1, error: 0.94, uploadFrom: 0.14 } as const;

export default function UploadZone() {
  const field = useRef<FieldHandle>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [touch] = useState(isTouch);
  const [forceFailure, setForceFailure] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { status, file, progress, error, accept, retry, reset, setOver } = useUpload({ forceFailure });

  // Drag events fire per-child; a counter is the only reliable way to know when the
  // pointer has genuinely left the zone rather than crossed onto something inside it.
  const dragDepth = useRef(0);

  // ---- drive the field ----------------------------------------------------
  // `engage` holds the camera in close for anything that is not idle, so uploading and
  // error keep the globe at full size instead of snapping back to the resting zoom.
  useEffect(() => {
    const f = field.current;
    if (!f) return;
    // `spread` releases the globe mask: the mass opens out into a full field for the
    // upload, then gathers back into an orb once it lands either way.
    if (status === 'uploading') f.set({ fill: LEVEL.uploadFrom + progress * (1 - LEVEL.uploadFrom), tint: 0, drag: 0, engage: 1, spread: 1 });
    else if (status === 'success') f.set({ fill: 1, tint: 0, engage: 1, spread: 0 });
    else if (status === 'error') f.set({ fill: LEVEL.error, tint: 1, drag: 0, engage: 1, spread: 0 });
    else if (status === 'over') f.set({ fill: LEVEL.over, tint: 0, drag: 1, engage: 1, spread: 0 });
    else f.set({ fill: hovered ? LEVEL.hover : LEVEL.idle, tint: 0, drag: 0, engage: 0, spread: 0 });
  }, [status, progress, hovered]);

  useEffect(() => {
    field.current?.set({ hover: hovered || status === 'over' ? 1 : 0 });
  }, [hovered, status]);

  // The readout flips from ink to white as the waterline passes beneath it. Driven off
  // the field's own smoothed value so the text and the liquid can never disagree.
  const onSample = useCallback((s: { fill: number }) => {
    const zone = zoneRef.current;
    if (!zone) return;
    const t = Math.min(1, Math.max(0, (s.fill - 0.6) / 0.28));
    zone.style.setProperty('--wet', String(t * t * (3 - 2 * t)));
  }, []);

  // ---- the surfacing sequence --------------------------------------------
  // Rise, hold, leave.
  //
  // The image comes up *through* the liquid, so it has to arrive blurred and resolve as
  // it surfaces. Animating `filter: blur()` does that but re-rasterises the image every
  // frame, which is what made it stutter. Instead two copies are stacked -- one with a
  // static blur, one sharp -- and only their opacity crosses. Everything animated here
  // is transform or opacity, so it all stays on the compositor.
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const softRef = useRef<HTMLImageElement>(null);
  const sharpRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (status !== 'success' || !scope.current) return;

    let cancelled = false;
    const reduced = prefersReducedMotion();
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

    const sequence = async () => {
      try {
        if (reduced) {
          await animate(scope.current, { opacity: 1, y: '0%', scale: 1 }, { duration: 0.26 });
          if (softRef.current) animate(softRef.current, { opacity: 0 }, { duration: 0.2 });
          if (sharpRef.current) animate(sharpRef.current, { opacity: 1 }, { duration: 0.2 });
        } else {
          const rise = animate(
            scope.current,
            { y: ['62%', '0%'], scale: [0.86, 1], opacity: [0, 1] },
            { duration: 0.9, ease: [0.19, 0.9, 0.28, 1] }
          );
          // Surfacing: the blur clears over the back half of the climb.
          if (softRef.current) animate(softRef.current, { opacity: [1, 0] }, { duration: 0.5, delay: 0.34, ease: 'easeOut' });
          if (sharpRef.current) animate(sharpRef.current, { opacity: [0, 1] }, { duration: 0.5, delay: 0.34, ease: 'easeOut' });

          // Break the surface: a short thickening of the glass as the image passes through.
          setTimeout(() => field.current?.set({ drag: 0.5 }), 400);
          setTimeout(() => field.current?.set({ drag: 0 }), 700);

          await rise;
        }
        if (cancelled) return;
        await wait(HOLD_MS);
        if (cancelled) return;

        await animate(
          scope.current,
          { y: '-92%', scale: 1.04, opacity: 0 },
          reduced ? { duration: 0.26 } : { duration: 0.72, ease: [0.5, 0, 0.75, 0.4] }
        );
        if (cancelled) return;

        // The zone settles back only after the image has gone, so the two never compete.
        field.current?.set({ fill: LEVEL.idle, engage: 0 });
        await wait(reduced ? 120 : 420);
        if (cancelled) return;
        reset();
      } catch {
        /* animation cancelled by unmount or a new file */
      }
    };

    void sequence();
    return () => {
      cancelled = true;
    };
  }, [status, reset, animate, scope]);

  // ---- drag and drop ------------------------------------------------------
  useEffect(() => {
    // Without a window-level guard the browser navigates away when a drop lands
    // anywhere but the zone, which silently destroys whatever the user was doing.
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  const busy = status === 'uploading' || status === 'success';

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (busy) return;
    dragDepth.current += 1;
    if (dragDepth.current === 1) setOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (busy) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    if (busy) return;
    setOver(false);
    accept(e.dataTransfer.files);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    field.current?.setPointer((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
    // Repaint on the move itself. The loop is the usual driver, but it is paused
    // whenever the document reports itself hidden, and parallax that only responds
    // some of the time reads as broken.
    field.current?.draw();
  };

  const openPicker = () => inputRef.current?.click();
  const primaryAction = () => (error?.retryable ? retry() : openPicker());

  const pct = Math.round(progress * 100);

  const errorLabel = error?.overLimit ? 'File over limit of 8.0 MB' : 'Upload error';

  // Nothing to say while the level travels, and nothing after -- the image is the message.
  const label =
    status === 'uploading' || status === 'success' ? ''
      : status === 'over' ? 'Let go to upload'
        : status === 'error' ? errorLabel
          : touch ? 'Add an image'
            : 'Drop an image';

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        ref={zoneRef}
        data-status={status}
        onDragEnter={onDragEnter}
        onDragOver={e => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPointerMove={onPointerMove}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => {
          setHovered(false);
          field.current?.setPointer(0.5, 0.5);
        }}
        className="zone relative isolate aspect-square w-[min(546px,calc(100vw-40px))] overflow-hidden rounded-[22px]"
      >
        <TransmissionField ref={field} onSample={onSample} />

        {/* The image sits above the canvas; "submerged" is sold with an animated blur
            rather than real occlusion, which keeps the whole field to one opaque pass. */}
        {file && (status === 'uploading' || status === 'success') && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-[52%] w-[44%] -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            {/* Centring lives on the outer wrapper: the sequence animates `transform` on
                the inner one, which would otherwise clobber a translate used for centring. */}
            <div ref={scope} className="relative flex h-full w-full items-center justify-center opacity-0 will-change-transform">
              <img
                ref={softRef}
                src={file.url}
                alt=""
                aria-hidden
                className="max-h-full max-w-full rounded-[6px] blur-[18px] saturate-150 brightness-125"
              />
              <img
                ref={sharpRef}
                src={file.url}
                alt=""
                className="absolute max-h-full max-w-full rounded-[6px] opacity-0 shadow-[0_4px_280px_42px_rgba(0,0,0,0.20)]"
              />
            </div>
          </div>
        )}

        <div className="readout pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-8 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-[15px] font-medium leading-snug tracking-[-0.01em] text-balance">{label}</p>

            {status === 'idle' || status === 'over' ? (
              <p className="text-[12.5px] leading-normal text-[color-mix(in_oklab,var(--readout-ink),transparent_45%)]">
                {status === 'over' ? 'One image at a time' : 'JPG, PNG, WebP Max 8.0 MB'}
              </p>
            ) : null}

            {status === 'error' ? (
              <p className="text-[12.5px] leading-normal text-[color-mix(in_oklab,var(--readout-ink),transparent_38%)]">
                Try again
              </p>
            ) : null}
          </div>
        </div>

        {!busy && (
          <button
            type="button"
            onClick={primaryAction}
            aria-label={error ? `${errorLabel}. Try again.` : 'Choose an image to upload'}
            // The zone clips its overflow, so an outset ring would be cut off. An inset ring sits
            // inside the bounds and stays whole.
            className="absolute inset-0 z-30 cursor-pointer rounded-[22px] outline-none ring-inset ring-[var(--focus)] focus-visible:ring-[3px]"
          />
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="sr-only"
          onChange={e => {
            accept(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <p aria-live="polite" className="sr-only">
        {status === 'uploading' ? `Uploading, ${pct} percent`
          : status === 'error' ? `${errorLabel}. Try again.`
            : ''}
      </p>

      {/* One control, two placements. Only ever one is displayed, and `display: none`
          keeps the other out of the accessibility tree entirely. */}
      <GlassToggle
        checked={forceFailure}
        onChange={setForceFailure}
        label="Make the next upload fail"
        className="sm:hidden"
      />
      <GlassToggle
        checked={forceFailure}
        onChange={setForceFailure}
        label="Make the next upload fail"
        scale={0.8}
        className="fixed right-6 top-7 z-40 hidden sm:flex sm:right-10"
      />
    </div>
  );
}
