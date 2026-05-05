/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        onyx: '#0F0F0F',
        trueBlack: '#000000',
        dark: {
          900: '#0F0F0F',
          850: '#12121a',
          800: '#151520',
          700: '#1a1a25',
          600: '#252535',
          500: '#353545',
        },
        neon: {
          blue: '#00D4FF',
          purple: '#7B61FF',
        },
        accent: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0, 212, 255, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 212, 255, 0.5)' },
        }
      }
    },
  },
  plugins: [],
}