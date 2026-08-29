import type { AvatarKey } from '@/types';
import { avatarColor } from '@/lib/constants';

/**
 * Ten inline SVG marks (spec §16.2). Inlined rather than fetched, and drawn
 * from big simple shapes so they still read at 32 px.
 */
const SHAPES: Record<AvatarKey, JSX.Element> = {
  fox: (
    <>
      <path d="M6 9 L10 5 L11.5 10 Z" />
      <path d="M26 9 L22 5 L20.5 10 Z" />
      <path d="M16 27 C8 22 6 16 6.5 9.5 C10 12 22 12 25.5 9.5 C26 16 24 22 16 27 Z" />
      <circle cx="12.5" cy="16" r="1.6" fill="#0E0D12" />
      <circle cx="19.5" cy="16" r="1.6" fill="#0E0D12" />
      <path d="M16 20.5 L14 22.5 h4 Z" fill="#0E0D12" />
    </>
  ),
  owl: (
    <>
      <path d="M7 8 L11 11 L7.5 12 Z" />
      <path d="M25 8 L21 11 L24.5 12 Z" />
      <path d="M16 27 C9 27 6 22 6 16 C6 10 10 6 16 6 C22 6 26 10 26 16 C26 22 23 27 16 27 Z" />
      <circle cx="12" cy="15" r="4" fill="#0E0D12" />
      <circle cx="20" cy="15" r="4" fill="#0E0D12" />
      <circle cx="12" cy="15" r="1.5" fill="#EDEAF2" />
      <circle cx="20" cy="15" r="1.5" fill="#EDEAF2" />
      <path d="M16 19 L14 21.5 h4 Z" fill="#0E0D12" />
    </>
  ),
  bear: (
    <>
      <circle cx="8.5" cy="9" r="4" />
      <circle cx="23.5" cy="9" r="4" />
      <circle cx="16" cy="17.5" r="9.5" />
      <circle cx="12.5" cy="15.5" r="1.5" fill="#0E0D12" />
      <circle cx="19.5" cy="15.5" r="1.5" fill="#0E0D12" />
      <ellipse cx="16" cy="21" rx="4" ry="3" fill="#0E0D12" opacity="0.25" />
      <ellipse cx="16" cy="19.5" rx="1.8" ry="1.3" fill="#0E0D12" />
    </>
  ),
  frog: (
    <>
      <circle cx="10" cy="10" r="4.5" />
      <circle cx="22" cy="10" r="4.5" />
      <circle cx="10" cy="10" r="1.8" fill="#0E0D12" />
      <circle cx="22" cy="10" r="1.8" fill="#0E0D12" />
      <path d="M4 16 C4 22 9 26 16 26 C23 26 28 22 28 16 Z" />
      <path d="M11 21 C13 23.5 19 23.5 21 21" stroke="#0E0D12" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  ),
  whale: (
    <>
      <path d="M4 18 C4 12 9 8 16 8 C23 8 28 12 28 18 C28 22 24 24 16 24 C8 24 4 22 4 18 Z" />
      <path d="M27 15 L31 10 L30 17 Z" />
      <path d="M16 8 C16 5 14.5 3.5 13 3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="10" cy="16" r="1.6" fill="#0E0D12" />
      <path d="M6 21 C10 23 20 23 25 21" stroke="#0E0D12" strokeWidth="1.4" fill="none" opacity="0.3" />
    </>
  ),
  cat: (
    <>
      <path d="M6 6 L7 14 L12 10 Z" />
      <path d="M26 6 L25 14 L20 10 Z" />
      <path d="M16 27 C9 27 6 22 6 16 C6 11 10 8 16 8 C22 8 26 11 26 16 C26 22 23 27 16 27 Z" />
      <path d="M11 15 L13.5 17 L11 19 Z" fill="#0E0D12" />
      <path d="M21 15 L18.5 17 L21 19 Z" fill="#0E0D12" />
      <path d="M16 20 L14.5 21.5 h3 Z" fill="#0E0D12" />
      <path d="M3 18 h6 M3 21 h6 M23 18 h6 M23 21 h6" stroke="currentColor" strokeWidth="1.2" opacity="0.5" strokeLinecap="round" />
    </>
  ),
  crow: (
    <>
      <path d="M20 26 C11 26 5 20 5 14 C5 9 9 5 15 5 C21 5 25 9 25 14 L25 17 Z" />
      <path d="M25 13 L31 15 L25 17.5 Z" fill="#D4A017" />
      <circle cx="17" cy="12" r="2" fill="#EDEAF2" />
      <circle cx="17" cy="12" r="0.9" fill="#0E0D12" />
      <path d="M7 17 C10 21 15 23 20 23" stroke="#0E0D12" strokeWidth="1.3" fill="none" opacity="0.35" />
    </>
  ),
  deer: (
    <>
      <path d="M9 10 L7 4 M9 10 L4 6 M9 10 L10 4" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" />
      <path d="M23 10 L25 4 M23 10 L28 6 M23 10 L22 4" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" />
      <path d="M16 28 C11 28 9 23 9 18 C9 13 12 10 16 10 C20 10 23 13 23 18 C23 23 21 28 16 28 Z" />
      <circle cx="13" cy="17" r="1.5" fill="#0E0D12" />
      <circle cx="19" cy="17" r="1.5" fill="#0E0D12" />
      <ellipse cx="16" cy="23" rx="2" ry="1.5" fill="#0E0D12" />
    </>
  ),
  fish: (
    <>
      <path d="M3 16 C7 9 15 7 22 10 C26 12 28 14 29 16 C28 18 26 20 22 22 C15 25 7 23 3 16 Z" />
      <path d="M3 16 L-1 11 L0 16 L-1 21 Z" transform="translate(4 0)" />
      <circle cx="22" cy="14.5" r="1.6" fill="#0E0D12" />
      <path d="M14 11 C16 14 16 18 14 21" stroke="#0E0D12" strokeWidth="1.4" fill="none" opacity="0.3" />
      <path d="M18 10 C20 13 20 19 18 22" stroke="#0E0D12" strokeWidth="1.4" fill="none" opacity="0.3" />
    </>
  ),
  moth: (
    <>
      <path d="M15 16 C10 8 4 7 3 12 C2 17 7 20 15 18 Z" />
      <path d="M17 16 C22 8 28 7 29 12 C30 17 25 20 17 18 Z" />
      <path d="M15 17 C11 22 6 24 6 27 C9 28 13 25 15 21 Z" opacity="0.75" />
      <path d="M17 17 C21 22 26 24 26 27 C23 28 19 25 17 21 Z" opacity="0.75" />
      <ellipse cx="16" cy="17" rx="1.7" ry="6" fill="#0E0D12" />
      <path d="M15 11 C13 7 12 6 10 5 M17 11 C19 7 20 6 22 5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </>
  ),
};

export function Avatar({
  avatarKey,
  size = 40,
  dimmed = false,
  className = '',
}: {
  avatarKey: AvatarKey | string;
  size?: number;
  dimmed?: boolean;
  className?: string;
}) {
  const key = (avatarKey in SHAPES ? avatarKey : 'fox') as AvatarKey;
  const color = avatarColor(key);
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={key}
      className={`${className} ${dimmed ? 'opacity-40 saturate-0' : ''}`}
      style={{ color, fill: color }}
    >
      {SHAPES[key]}
    </svg>
  );
}

export function AvatarBadge({
  avatarKey,
  size = 44,
  ring,
  dimmed,
}: {
  avatarKey: AvatarKey | string;
  size?: number;
  ring?: string;
  dimmed?: boolean;
}) {
  const color = avatarColor(avatarKey);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-2xl border-2 border-black/40"
      style={{
        width: size,
        height: size,
        // A tint of the avatar's own colour, so a grid of faces reads as a
        // set of chunky stickers rather than a row of dark squares.
        background: dimmed
          ? '#161522'
          : `linear-gradient(150deg, ${color}33, rgba(11,10,16,0.9))`,
        boxShadow: ring
          ? `0 0 0 3px ${ring}, 0 3px 0 0 rgba(0,0,0,0.5)`
          : '0 3px 0 0 rgba(0,0,0,0.45)',
      }}
    >
      <Avatar avatarKey={avatarKey} size={Math.round(size * 0.72)} dimmed={dimmed} />
    </span>
  );
}
