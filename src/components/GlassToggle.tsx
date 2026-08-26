import { motion } from 'motion/react';

/**
 * iOS-proportioned switch: 51 × 31 with a 27px knob and 20px of travel, scaled as a
 * whole by `scale`.
 */
export default function GlassToggle({
  checked,
  onChange,
  label,
  scale = 1,
  className = '',
  tint = 'var(--alarm)'
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  scale?: number;
  className?: string;
  tint?: string;
}) {
  const track = { w: 51 * scale, h: 31 * scale };
  const knob = 27 * scale;
  const inset = 2 * scale;
  const travel = track.w - knob - inset * 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`group flex cursor-pointer select-none items-center rounded-full outline-none ${className}`.trim()}
      style={{ gap: 10 * scale }}
    >
      <span
        className="text-[var(--mute)] transition-colors group-hover:text-[var(--ink)] group-focus-visible:text-[var(--ink)]"
        style={{ fontSize: 13 * scale }}
      >
        {label}
      </span>

      <motion.span
        className="relative block shrink-0 rounded-full"
        style={{
          width: track.w,
          height: track.h,
          boxShadow: 'inset 0 1px 2px rgb(11 13 18 / 0.10), inset 0 0 0 0.5px rgb(11 13 18 / 0.06)'
        }}
        animate={{ backgroundColor: checked ? tint : '#e4e5e9' }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <motion.span
          className="absolute block rounded-full"
          style={{
            width: knob,
            height: knob,
            left: inset,
            top: inset,
            transformOrigin: checked ? 'right center' : 'left center',
            background: 'rgb(255 255 255 / 0.82)',
            backdropFilter: 'blur(7px) saturate(1.8)',
            WebkitBackdropFilter: 'blur(7px) saturate(1.8)',
            boxShadow: [
              '0 1px 2px rgb(11 13 18 / 0.16)',
              '0 4px 10px -2px rgb(11 13 18 / 0.18)',
              'inset 0 1px 0.5px rgb(255 255 255 / 0.95)',
              'inset 0 -1px 2px rgb(11 13 18 / 0.07)',
              'inset 0 0 0 0.5px rgb(255 255 255 / 0.55)'
            ].join(', ')
          }}
          animate={{ x: checked ? travel : 0 }}
          transition={{ type: 'spring', stiffness: 620, damping: 34, mass: 0.7 }}
          whileTap={{ scaleX: 1.16 }}
        />
      </motion.span>
    </button>
  );
}
