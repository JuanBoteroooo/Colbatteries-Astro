/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
		extend: {
			colors: {
				brand: {
					blue: '#024598',
					yellow: '#f2a900',
					red: '#e64132',
				},
			},
			fontFamily: {
				heading: ['Montserrat', 'sans-serif'],
				body: ['Inter', 'sans-serif'],
				mono: ['IBM Plex Mono', 'monospace'],
			},
			keyframes: {
				float: {
					'0%, 100%': { transform: 'translateY(0)' },
					'50%': { transform: 'translateY(var(--float-amp, -14px))' },
				},
				pulseDot: {
					'0%, 100%': { boxShadow: '0 0 0 0 rgba(242,169,0,0.45)' },
					'50%': { boxShadow: '0 0 0 6px rgba(242,169,0,0)' },
				},
				glowPulse: {
					'0%, 100%': { opacity: '0.55', transform: 'translate(-50%,-50%) scale(1)' },
					'50%': { opacity: '0.9', transform: 'translate(-50%,-50%) scale(1.12)' },
				},
			},
			animation: {
				float: 'float 6s ease-in-out infinite',
				pulseDot: 'pulseDot 1.8s ease-in-out infinite',
				glowPulse: 'glowPulse 4.5s ease-in-out infinite',
			},
		},
	},
	plugins: [],
	corePlugins: {
		// The rest of the site is hand-written CSS; scope Tailwind's reset off
		// so it never fights existing global styles outside opted-in components.
		preflight: false,
	},
}
