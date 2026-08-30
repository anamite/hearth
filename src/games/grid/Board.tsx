import { GRID_CELLS, GRID_SIDE, lineCells } from '@/backend/mock/games/grid';

/**
 * One 5x5 square. Used three ways: yours to write in during the reveals,
 * everybody's during the walkthrough, and a small read-only copy on the
 * result screen.
 */
export function Board({
  cells,
  onPick,
  disabled = false,
  highlightLine = null,
  size = 'md',
}: {
  cells: (number | null)[];
  onPick?: (cell: number) => void;
  disabled?: boolean;
  /** 0-4 rows, 5-9 columns — the line currently being scored. */
  highlightLine?: number | null;
  size?: 'sm' | 'md';
}) {
  const lit = highlightLine == null ? null : new Set(lineCells(highlightLine));
  const box = size === 'sm' ? 'text-base' : 'text-[1.6rem]';
  const gap = size === 'sm' ? 'gap-1' : 'gap-1.5';

  return (
    <div className={`grid grid-cols-5 ${gap}`} role="grid" aria-label="Your grid">
      {Array.from({ length: GRID_CELLS }, (_, i) => {
        const value = cells?.[i] ?? null;
        const empty = value == null;
        const isLit = lit?.has(i) ?? false;
        const tappable = empty && !disabled && !!onPick;

        return (
          <button
            key={i}
            type="button"
            disabled={!tappable}
            onClick={tappable ? () => onPick!(i) : undefined}
            aria-label={empty ? `Empty cell ${i + 1}` : `Cell ${i + 1}, ${value}`}
            className={[
              'no-select relative flex aspect-square items-center justify-center',
              'rounded-xl border-2 font-display font-extrabold tabular-nums',
              'transition-all duration-100',
              box,
              // One branch only: two Tailwind utilities for the same
              // property would fight, and the loser is stylesheet order.
              isLit
                ? 'border-accent bg-accent/25 text-chalk shadow-glow'
                : !empty
                  ? 'border-edge bg-slatey/80 text-chalk'
                  : tappable
                    ? 'cursor-pointer border-dashed border-accent/60 bg-accent/10 text-transparent active:translate-y-[2px] active:bg-accent/30'
                    : 'border-dashed border-edge bg-ink/40 text-transparent',
            ].join(' ')}
          >
            {value ?? ''}
          </button>
        );
      })}
    </div>
  );
}

/** "Row 3" / "Column 1" — how the walkthrough names the line on screen. */
export function lineLabel(i: number): string {
  return i < GRID_SIDE ? `Row ${i + 1}` : `Column ${i - GRID_SIDE + 1}`;
}
