import { fileURLToPath } from 'node:url';
import netlify from '@netlify/vite-plugin-tanstack-start';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { isPublicDeployment } from './src/common/utils/isPublicDeployment.ts';

/**
 * The engine imports its agent prompts and standards documents as `.md`
 * modules. esbuild is handed `loader: { '.md': 'text' }` in
 * scripts/buildEngine.mjs and Jest a transformer in tooling/jest; this is the
 * third of the three, and all three have to agree that a markdown import is a
 * string.
 */
const markdownAsText = (): Plugin => ({
	name: 'lightsout-markdown-as-text',
	transform(code, id) {
		return id.endsWith('.md') ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined;
	},
});

/**
 * Netlify sets `NETLIFY` on every build it runs, so the adapter that turns the
 * server build into Netlify Functions joins only there and a local build stays
 * the plain server `start:prod` runs.
 */
const onNetlify = process.env.NETLIFY === 'true';

/**
 * The site's own address. A deploy that states one wins; on Netlify the
 * platform's `URL` — the site's main address — fills the gap, so the social
 * tags carry the origin they are served from without a second place to set it.
 */
const siteOrigin = process.env.VITE_SITE_ORIGIN ?? (onNetlify ? process.env.URL : undefined);

export default defineConfig({
	// The two build-time values this app reads, baked into both bundles.
	//
	// `homeMeta` needs an absolute origin for the two social tags that carry a
	// URL, and is left undefined when no deploy states one, which is what makes
	// those two tags optional.
	//
	// `LIGHTSOUT_PUBLIC` is checked here, so a value other than `1`, `0` or
	// nothing fails the build rather than shipping `/app` to a public site. It
	// is baked in rather than read at run time because the browser has no
	// environment at all, and a host's function runtime is not guaranteed the
	// build's. Written back as `1` or empty, the two values
	// `isPublicDeployment` reads the same way on either side.
	//
	// Spelled `process.env` rather than `import.meta.env` because the same files
	// are compiled to CommonJS by the app's own suite, where `import.meta` will
	// not parse.
	define: {
		'process.env.VITE_SITE_ORIGIN': JSON.stringify(siteOrigin ?? ''),
		'process.env.LIGHTSOUT_PUBLIC': JSON.stringify(isPublicDeployment() ? '1' : ''),
	},
	// A plain literal: this app is started by hand, so there is no environment to
	// read a port out of.
	server: { port: 4317 },
	// Every workspace package this app reaches ships TypeScript source, so Vite
	// has to transform them rather than hand them to Node. The engine's own
	// third-party dependencies stay external and resolve at run time from where
	// pnpm installed them, beside the engine.
	ssr: { noExternal: [/^@lightsout\//] },
	// The repo-root assets/ and docs/ folders. A package `imports` entry may not
	// escape the package, so each alias is spelled here, in tsconfig.json `paths`
	// and in jest.config.cjs `moduleNameMapper` — three declarations of one path.
	// Vite parses an imported .json into a module, which is what the sprawl
	// dataset needs: the component reads the data, not a link to it, and the
	// plugin above turns each docs/*.md import into its own text.
	resolve: {
		alias: {
			'#assets': fileURLToPath(new URL('../../assets', import.meta.url)),
			'#docs': fileURLToPath(new URL('../../docs', import.meta.url)),
		},
	},
	optimizeDeps: { exclude: ['@lightsout/engine', '@lightsout/shared'] },
	plugins: [markdownAsText(), tanstackStart(), ...(onNetlify ? [netlify()] : []), tailwindcss(), viteReact()],
});
