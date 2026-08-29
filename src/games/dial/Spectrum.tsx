import { useCallback, useEffect, useRef, useState } from 'react';
import { getBackend } from '@/backend';
import type { EphemeralEvent } from '@/types';

const W = 320;
const H = 132;
const ARC_R = 120;
const CX = W / 2;
const CY = H + 8;

/** Position 0..100 → a point on the arc. */
function pointAt(pos: number, radius = ARC_R): { x: number; y: number; angle: number } {
  const angle = Math.PI - (pos / 100) * Math.PI;
  return { x: CX + Math.cos(angle) * radius, y: CY - Math.sin(angle) * radius, angle };
}

function arcPath(from: number, to: number, radius: number): string {
  const a = pointAt(from, radius);
  const b = pointAt(to, radius);
  const large = Math.abs(to - from) > 50 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
}

/** Scoring bands drawn around the target (§13.1). */
const BANDS = [
  { half: 15, fill: '#3DDC84', opacity: 0.18 },
  { half: 8, fill: '#3DDC84', opacity: 0.3 },
  { half: 3, fill: '#3DDC84', opacity: 0.62 },
];

const ACCENT = 'rgb(var(--accent-rgb))';

/** Evenly spaced notches around the arc, purely to make it read as a dial. */
const TICKS = Array.from({ length: 21 }, (_, i) => i * 5);

export function Spectrum({
  left,
  right,
  target,
  guess,
  draggable = false,
  roundId,
  onChange,
  showTarget = false,
}: {
  left: string;
  right: string;
  target?: number | null;
  guess?: number | null;
  draggable?: boolean;
  roundId?: string;
  onChange?: (pos: number) => void;
  showTarget?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [localPos, setLocalPos] = useState<number>(guess ?? 50);
  const [remotePos, setRemotePos] = useState<number | null>(null);
  const lastSent = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current && typeof guess === 'number') setLocalPos(guess);
  }, [guess]);

  // Everyone watches the dial move while the group argues (§13.6).
  useEffect(() => {
    if (!roundId || draggable) return;
    return getBackend().subscribeEphemeral(roundId, (e: EphemeralEvent) => {
      if (e.type === 'dial_move') setRemotePos(e.position);
    });
  }, [roundId, draggable]);

  const posFromEvent = useCallback((clientX: number, clientY: number): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = rect.width / W;
    const x = (clientX - rect.left) / scale - CX;
    const y = CY - (clientY - rect.top) / scale;
    let angle = Math.atan2(Math.max(y, 0.0001), x);
    angle = Math.max(0, Math.min(Math.PI, angle));
    return Math.round(((Math.PI - angle) / Math.PI) * 100);
  }, []);

  const handleMove = (clientX: number, clientY: number) => {
    const pos = posFromEvent(clientX, clientY);
    setLocalPos(pos);
    const now = performance.now();
    if (roundId && now - lastSent.current > 50) {
      lastSent.current = now;
      getBackend().publishEphemeral(roundId, { type: 'dial_move', player_id: 'me', position: pos });
    }
  };

  const shown = draggable ? localPos : (remotePos ?? guess ?? localPos);
  const needle = pointAt(shown);
  const needleInner = pointAt(shown, 34);

  return (
    <div className="select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H + 16}`}
        className={`w-full ${draggable ? 'touch-none-safe cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={(e) => {
          if (!draggable) return;
          e.preventDefault();
          (e.target as Element).setPointerCapture?.(e.pointerId);
          dragging.current = true;
          handleMove(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!draggable || !dragging.current) return;
          handleMove(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (!draggable || !dragging.current) return;
          dragging.current = false;
          const pos = posFromEvent(e.clientX, e.clientY);
          setLocalPos(pos);
          onChange?.(pos);
        }}
      >
        {/* Track — a dark well with a lighter lip, so it reads as a groove. */}
        <path
          d={arcPath(0, 100, ARC_R)}
          fill="none"
          stroke="#38334F"
          strokeWidth="26"
          strokeLinecap="round"
        />
        <path
          d={arcPath(0, 100, ARC_R)}
          fill="none"
          stroke="#0B0A10"
          strokeWidth="20"
          strokeLinecap="round"
          opacity="0.55"
        />

        {/* Notches */}
        {TICKS.map((t) => {
          const a = pointAt(t, ARC_R - 9);
          const b = pointAt(t, ARC_R + (t % 25 === 0 ? 10 : 6));
          return (
            <line
              key={t}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#F4F1FA"
              strokeWidth={t % 25 === 0 ? 2 : 1.1}
              strokeLinecap="round"
              opacity={t % 25 === 0 ? 0.4 : 0.16}
            />
          );
        })}

        {/* Target bands — only ever rendered when the caller has the target. */}
        {showTarget && typeof target === 'number' &&
          BANDS.map((b) => (
            <path
              key={b.half}
              d={arcPath(
                Math.max(0, target - b.half),
                Math.min(100, target + b.half),
                ARC_R,
              )}
              fill="none"
              stroke={b.fill}
              strokeOpacity={b.opacity}
              strokeWidth="20"
              strokeLinecap="butt"
            />
          ))}
        {showTarget && typeof target === 'number' && (
          <line
            x1={pointAt(target, ARC_R - 12).x}
            y1={pointAt(target, ARC_R - 12).y}
            x2={pointAt(target, ARC_R + 12).x}
            y2={pointAt(target, ARC_R + 12).y}
            stroke="#3DDC84"
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}

        {/* Needle */}
        <line
          x1={needleInner.x}
          y1={needleInner.y}
          x2={needle.x}
          y2={needle.y}
          stroke="#0B0A10"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <line
          x1={needleInner.x}
          y1={needleInner.y}
          x2={needle.x}
          y2={needle.y}
          stroke={ACCENT}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r="9" fill={ACCENT} stroke="#0B0A10" strokeWidth="2.5" />
        <circle cx={needle.x} cy={needle.y} r="7" fill={ACCENT} stroke="#0B0A10" strokeWidth="2.5" />
        {draggable && <circle cx={needle.x} cy={needle.y} r="15" fill={ACCENT} opacity="0.25" />}
      </svg>

      <div className="mt-2 flex items-start justify-between gap-3">
        <span className="max-w-[46%] rounded-xl border-2 border-edge/80 bg-slatey/60 px-2.5 py-1.5
                         text-left text-[0.78rem] font-bold leading-tight text-chalk/80">
          {left}
        </span>
        <span className="max-w-[46%] rounded-xl border-2 border-edge/80 bg-slatey/60 px-2.5 py-1.5
                         text-right text-[0.78rem] font-bold leading-tight text-chalk/80">
          {right}
        </span>
      </div>
      <div className="sr-only" aria-live="polite">
        Dial at {shown} of 100
      </div>
    </div>
  );
}
