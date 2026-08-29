/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0E0D12',
        ash: '#17161D',
        slatey: '#22212B',
        edge: '#33313F',
        mute: '#8B8798',
        chalk: '#EDEAF2',
        ember: '#E8743B',
        moss: '#4CA64C',
        blood: '#C6413B',
      },
      fontFamily: {
        display: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        'pulse-ring': { '0%': { transform: 'scale(0.9)', opacity: '0.7' }, '100%': { transform: 'scale(1.35)', opacity: '0' } },
      },
      animation: {
        'fade-up': 'fade-up 260ms ease-out both',
        'pulse-ring': 'pulse-ring 1.4s ease-out infinite',
      },
    },
  },
  plugins: [],
};
