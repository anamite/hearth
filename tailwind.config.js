/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Base: a deep, slightly violet night ---------------------
        ink: '#0B0A10',
        ash: '#161522',
        slatey: '#221F33',
        edge: '#38334F',
        mute: '#948FAE',
        chalk: '#F4F1FA',

        // --- Fixed accents (the toybox) -------------------------------
        ember: '#FF7A29',
        punch: '#FF3D8B',
        grape: '#A78BFA',
        lagoon: '#22D3EE',
        lime: '#B9F227',
        gold: '#FFC53D',
        moss: '#3DDC84',
        blood: '#FF4D5E',

        // --- Live per-game accent, driven by [data-game] --------------
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        accent2: 'rgb(var(--accent2-rgb) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        blob: '2rem 2.25rem 1.75rem 2.5rem',
      },
      boxShadow: {
        // Chunky "sticker" drop — the whole look leans on these.
        pop: '0 5px 0 0 rgb(0 0 0 / 0.55)',
        'pop-sm': '0 3px 0 0 rgb(0 0 0 / 0.5)',
        'pop-lg': '0 8px 0 0 rgb(0 0 0 / 0.55)',
        glow: '0 0 32px -6px rgb(var(--accent-rgb) / 0.55)',
        'glow-lg': '0 0 60px -8px rgb(var(--accent-rgb) / 0.65)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.82) rotate(-4deg)' },
          '60%': { opacity: '1', transform: 'scale(1.05) rotate(1.5deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(0)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.5)', opacity: '0' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-9px) rotate(2.5deg)' },
        },
        'float-slow': {
          '0%,100%': { transform: 'translateY(0) rotate(-2deg)' },
          '50%': { transform: 'translateY(-14px) rotate(3deg)' },
        },
        wobble: {
          '0%,100%': { transform: 'rotate(-2.5deg)' },
          '50%': { transform: 'rotate(2.5deg)' },
        },
        jiggle: {
          '0%,100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-3px) rotate(-1deg)' },
          '75%': { transform: 'translateX(3px) rotate(1deg)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-140% 0' },
          '100%': { backgroundPosition: '240% 0' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(26px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'drift-x': {
          '0%,100%': { transform: 'translateX(-6px)' },
          '50%': { transform: 'translateX(6px)' },
        },
        'blink-dot': {
          '0%,100%': { opacity: '0.25' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 280ms cubic-bezier(.2,.9,.25,1) both',
        'pop-in': 'pop-in 380ms cubic-bezier(.2,1.3,.4,1) both',
        'pulse-ring': 'pulse-ring 1.5s ease-out infinite',
        float: 'float 5s ease-in-out infinite',
        'float-slow': 'float-slow 9s ease-in-out infinite',
        wobble: 'wobble 2.6s ease-in-out infinite',
        jiggle: 'jiggle 420ms ease-in-out 2',
        'spin-slow': 'spin-slow 26s linear infinite',
        shimmer: 'shimmer 2.6s linear infinite',
        rise: 'rise 420ms cubic-bezier(.2,.9,.25,1) both',
        'drift-x': 'drift-x 7s ease-in-out infinite',
        'blink-dot': 'blink-dot 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
