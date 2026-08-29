import { useCallback, useEffect, useRef, useState } from 'react';
import type { EphemeralEvent } from '@/types';
import { getBackend } from '@/backend';
import { capPoints, simplify, toPolyline, type Point } from '@/lib/rdp';
import { avatarColor } from '@/lib/constants';

export interface StrokeData {
  player_id: string;
  pass: number;
  points: Point[];
  color: string;
  width: number;
}

/** Fixed 3:4 portrait so every device renders the identical picture (§11.6). */
const VB_W = 300;
const VB_H = 400;
const BROADCAST_HZ = 20;

function Strokes({ strokes }: { strokes: StrokeData[] }) {
  return (
    <>
      {strokes.map((s, i) => (
        <polyline
          key={i}
          points={toPolyline(s.points, VB_W, VB_H)}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width * VB_W}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}

/** Read-only rendering, for the voting and result screens. */
export function DrawingView({
  strokes,
  className = '',
}: {
  strokes: StrokeData[];
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={`w-full rounded-[1.4rem] border-[3px] border-edge bg-[#F7F3EA] shadow-pop ${className}`}
      aria-label="The finished drawing"
    >
      <Strokes strokes={strokes} />
    </svg>
  );
}

/**
 * The live canvas. One continuous gesture per turn: pointerdown starts it,
 * pointerup ends the turn and commits (§11.6). Lifting the finger is final.
 */
export function DrawingCanvas({
  roundId,
  strokes,
  myTurn,
  myColor,
  strokeWidth = 0.008,
  onCommit,
}: {
  roundId: string;
  strokes: StrokeData[];
  myTurn: boolean;
  myColor: string;
  strokeWidth?: number;
  onCommit: (points: Point[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  const raw = useRef<Point[]>([]);
  const lastSent = useRef(0);
  const committed = useRef(false);

  const [live, setLive] = useState<Point[]>([]);
  const [remote, setRemote] = useState<Record<string, StrokeData>>({});

  // Other players' in-progress strokes.
  useEffect(() => {
    const off = getBackend().subscribeEphemeral(roundId, (e: EphemeralEvent) => {
      if (e.type === 'stroke_progress') {
        setRemote((r) => ({
          ...r,
          [e.player_id]: {
            player_id: e.player_id,
            pass: 0,
            points: e.points,
            color: e.color,
            width: e.width,
          },
        }));
      } else if (e.type === 'stroke_end') {
        setRemote((r) => {
          const next = { ...r };
          delete next[e.player_id];
          return next;
        });
      }
    });
    return off;
  }, [roundId]);

  // A committed stroke arriving from the server replaces the provisional one.
  useEffect(() => {
    setRemote({});
  }, [strokes.length]);

  const toNormalised = useCallback((e: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  }, []);

  const start = (e: React.PointerEvent) => {
    if (!myTurn || committed.current) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    raw.current = [toNormalised(e)];
    setLive(raw.current.slice());
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    raw.current.push(toNormalised(e));
    setLive(raw.current.slice());

    const now = performance.now();
    if (now - lastSent.current > 1000 / BROADCAST_HZ) {
      lastSent.current = now;
      getBackend().publishEphemeral(roundId, {
        type: 'stroke_progress',
        player_id: 'me',
        points: capPoints(raw.current, 200),
        color: myColor,
        width: strokeWidth,
      });
    }
  };

  const end = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current = false;
    getBackend().publishEphemeral(roundId, { type: 'stroke_end', player_id: 'me' });

    const points = capPoints(simplify(raw.current, 0.002));
    if (points.length < 2) {
      // A tap is not a line; let them try again rather than burning the turn.
      raw.current = [];
      setLive([]);
      return;
    }
    committed.current = true;
    onCommit(points);
  };

  const liveStroke: StrokeData[] = live.length
    ? [{ player_id: 'me', pass: 0, points: live, color: myColor, width: strokeWidth }]
    : [];

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={`w-full touch-none-safe rounded-[1.4rem] border-[3px] bg-[#F7F3EA] shadow-pop
        transition-colors ${myTurn ? 'border-accent' : 'border-edge'}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
    >
      <Strokes strokes={strokes} />
      <Strokes strokes={Object.values(remote)} />
      <Strokes strokes={liveStroke} />
    </svg>
  );
}

export function colorFor(avatarKey: string): string {
  return avatarColor(avatarKey);
}
