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
  { half: 15, fill: '#4CA64C', opacity: 0.16 },
  { half: 8, fill: '#4CA64C', opacity: 0.24 },
  { half: 3, fill: '#4CA64C', opacity: 0.5 },
];

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
        {/* Track */}
        <path
          d={arcPath(0, 100, ARC_R)}
          fill="none"
          stroke="#33313F"
          strokeWidth="22"
          strokeLinecap="round"
        />

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
              strokeWidth="22"
              strokeLinecap="butt"
            />
          ))}
        {showTarget && typeof target === 'number' && (
          <line
            x1={pointAt(target, ARC_R - 12).x}
            y1={pointAt(target, ARC_R - 12).y}
            x2={pointAt(target, ARC_R + 12).x}
            y2={pointAt(target, ARC_R + 12).y}
            stroke="#4CA64C"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )}

        {/* Needle */}
        <line
          x1={needleInner.x}
          y1={needleInner.y}
          x2={needle.x}
          y2={needle.y}
          stroke="#E8743B"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r="7" fill="#E8743B" />
        {draggable && <circle cx={needle.x} cy={needle.y} r="11" fill="#E8743B" opacity="0.28" />}
      </svg>

      <div className="mt-1 flex items-start justify-between gap-3 px-1">
        <span className="max-w-[45%] text-left text-sm font-semibold leading-tight text-mute">
          {left}
        </span>
        <span className="max-w-[45%] text-right text-sm font-semibold leading-tight text-mute">
          {right}
        </span>
      </div>
      <div className="sr-only" aria-live="polite">
        Dial at {shown} of 100
      </div>
    </div>
  );
}
