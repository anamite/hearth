/* ===============================================================
   PLACEHOLDER ART
   ---------------------------------------------------------------
   Everything in this file is a stand-in drawn from simple shapes.
   Each component keeps a fixed viewBox — replace the contents of a
   component with your own SVG at the same viewBox and every screen
   picks it up with no other change.

     HearthMark        24 x 24   app logo
     GameCharacter     64 x 64   one mascot per game (id-switched)
     Blob / Squiggle   decorative, non-semantic

   Colour: `currentColor` follows the surrounding text colour, and
   `rgb(var(--accent-rgb))` follows the current game accent.
   =============================================================== */

import type { GameType } from '@/types';

const ACCENT = 'rgb(var(--accent-rgb))';
const ACCENT2 = 'rgb(var(--accent2-rgb))';

// ---------------------------------------------------------------
// App mark — a blocky flame. PLACEHOLDER.
// ---------------------------------------------------------------

export function HearthMark({ size = 48, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      <path
        d="M12 2c1.6 5.2-3 6.8-5.2 10.2C5.4 14.5 5 16.3 5 18a7 7 0 0 0 14 0c0-2.3-.9-4.2-2.6-6.2-.5 1.7-1.4 2.6-2.4 2.9C14.7 10.9 14 6.4 12 2Z"
        fill={ACCENT}
        stroke="#0B0A10"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M12 11c.9 2.6-1.4 3.6-2.1 5.3-.3.7-.4 1.4-.4 2a2.7 2.7 0 0 0 5.4 0c0-1.2-.6-2.4-1.6-3.7-.3.9-.8 1.3-1.2 1.4.4-1.8-.1-3.6-.1-5Z"
        fill={ACCENT2}
      />
    </svg>
  );
}

// ---------------------------------------------------------------
// Game mascots. One simple character each. PLACEHOLDERS.
// viewBox 0 0 64 64 — keep it if you swap the art.
// ---------------------------------------------------------------

/** Fake Artist — a paint blob holding a brush, one big eye. */
function ArtistBlob() {
  return (
    <>
      <path
        d="M32 6c11 0 20 8 20 19 0 7-3 10-3 16 0 5-6 9-17 9s-17-4-17-9c0-6-3-9-3-16C12 14 21 6 32 6Z"
        fill={ACCENT}
        stroke="#0B0A10"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="27" r="10" fill="#F4F1FA" stroke="#0B0A10" strokeWidth="2.4" />
      <circle cx="34" cy="28" r="4.4" fill="#0B0A10" />
      <circle cx="35.6" cy="26.2" r="1.5" fill="#F4F1FA" />
      <path d="M22 43c4 3.5 16 3.5 20 0" stroke="#0B0A10" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      {/* brush */}
      <rect x="45" y="34" width="4.5" height="20" rx="2.2" transform="rotate(18 47 44)" fill="#0B0A10" />
      <path d="M52 52c2 2.5 2 5.5 0 7-2.5-1-4-3.5-3.5-6Z" fill={ACCENT2} stroke="#0B0A10" strokeWidth="1.6" />
    </>
  );
}

/** Night Village — a hooded wolf under a moon. */
function WolfHood() {
  return (
    <>
      <circle cx="47" cy="15" r="8" fill={ACCENT2} opacity="0.85" />
      <circle cx="43.5" cy="13" r="7" fill="#0B0A10" />
      <path
        d="M32 8 12 20c0 20 6 32 20 36 14-4 20-16 20-36L32 8Z"
        fill={ACCENT}
        stroke="#0B0A10"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M32 18 18 26c0 14 5 22 14 25 9-3 14-11 14-25L32 18Z" fill="#0B0A10" opacity="0.82" />
      <path d="M25 32l6 3-6 3z" fill={ACCENT2} />
      <path d="M39 32l-6 3 6 3z" fill={ACCENT2} />
      <path d="M28 45c2 2 6 2 8 0" stroke={ACCENT2} strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </>
  );
}

/** Dial — a little gauge creature with a needle. */
function GaugeGuy() {
  return (
    <>
      <circle cx="32" cy="34" r="24" fill={ACCENT} stroke="#0B0A10" strokeWidth="2.4" />
      <circle cx="32" cy="34" r="17" fill="#0B0A10" />
      <path
        d="M16 36a16 16 0 0 1 32 0"
        stroke={ACCENT2}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      <path d="M32 36 22 24" stroke="#F4F1FA" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="32" cy="36" r="4" fill={ACCENT2} stroke="#0B0A10" strokeWidth="1.8" />
      <circle cx="24" cy="44" r="2.4" fill="#F4F1FA" />
      <circle cx="40" cy="44" r="2.4" fill="#F4F1FA" />
      <path d="M20 12l3 6 6-3" stroke={ACCENT2} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  );
}

const MASCOTS: Record<GameType, () => JSX.Element> = {
  fake_artist: ArtistBlob,
  night_village: WolfHood,
  dial: GaugeGuy,
};

export function GameCharacter({
  game,
  size = 56,
  className = '',
}: {
  game: GameType;
  size?: number;
  className?: string;
}) {
  const Mascot = MASCOTS[game] ?? ArtistBlob;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <Mascot />
    </svg>
  );
}

// ---------------------------------------------------------------
// Decorative. Purely background — safe to delete or replace.
// ---------------------------------------------------------------

/** A soft accent blob for behind hero content. */
export function Blob({ className = '', opacity = 0.5 }: { className?: string; opacity?: number }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden style={{ opacity }}>
      <path
        d="M52 22c26-14 62-8 82 14s22 56 6 78-52 32-80 22S18 100 22 74 34 32 52 22Z"
        fill={ACCENT}
      />
    </svg>
  );
}

/** A hand-drawn underline, for putting emphasis under a word. */
export function Squiggle({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 10" className={className} aria-hidden preserveAspectRatio="none">
      <path
        d="M2 7c14-6 26 2 40-2s26 4 38 1 26-3 38-2"
        fill="none"
        stroke={ACCENT}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Three stacked bars, used as a texture behind headers. */
export function Bars({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 24" className={className} aria-hidden>
      <rect x="0" y="2" width="60" height="5" rx="2.5" fill={ACCENT} opacity="0.9" />
      <rect x="8" y="10" width="52" height="5" rx="2.5" fill={ACCENT2} opacity="0.7" />
      <rect x="18" y="18" width="42" height="5" rx="2.5" fill={ACCENT} opacity="0.4" />
    </svg>
  );
}

/** A crescent moon with a few Zs — Night Village's sleeping state. PLACEHOLDER. */
export function SleepingMoon({ size = 96, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} aria-hidden>
      <path
        d="M56 12a30 30 0 1 0 22 46 34 34 0 0 1-22-46Z"
        fill={ACCENT}
        stroke="#0B0A10"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="46" r="2.6" fill="#0B0A10" />
      <circle cx="54" cy="50" r="2.6" fill="#0B0A10" />
      <path d="M40 60c4 3 10 3 14-1" stroke="#0B0A10" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <text x="72" y="24" fill={ACCENT2} fontSize="15" fontWeight="800" fontFamily="inherit">z</text>
      <text x="82" y="14" fill={ACCENT2} fontSize="11" fontWeight="800" fontFamily="inherit">z</text>
    </svg>
  );
}
