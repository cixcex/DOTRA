/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0a',
        paper: '#fafaf9',
        mute: '#6b6b6b',
        line: '#e8e8e6',
        ok: '#15803d',
        warn: '#b45309',
        bad: '#b91c1c',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', '"Inter Variable"', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { tightest: '-0.04em' },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.08)',
        lift: '0 2px 4px rgba(0,0,0,0.05), 0 16px 40px -16px rgba(0,0,0,0.18)',
      },
    },
  },
  plugins: [],
};
