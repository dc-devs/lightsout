import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
	// The one build-time value this app reads. `homeMeta` needs an absolute
	// origin for the two social tags that carry a URL, and no deploy origin is
	// settled — so it is substituted here when the deploy states one and left
	// undefined otherwise, which is what makes those two tags optional. Spelled
	// `process.env` rather than `import.meta.env` because the same file is
	// compiled to CommonJS by the app's own suite, where `import.meta` will not
	// parse.
	define: { 'process.env.VITE_SITE_ORIGIN': JSON.stringify(process.env.VITE_SITE_ORIGIN ?? '') },
	// A plain literal: this app is started by hand, so there is no environment to
	// read a port out of.
	server: { port: 4317 },
	// Every workspace package this app reaches ships TypeScript source, so Vite
	// has to transform them rather than hand them to Node. The engine's own
	// third-party dependencies stay external and resolve at run time from where
	// pnpm installed them, beside the engine.
	ssr: { noExternal: [/^@lightsout\//] },
	// The repo-root assets/ folder. A package `imports` entry may not escape the
	// package, so this alias is spelled here, in tsconfig.json `paths` and in
	// jest.config.cjs `moduleNameMapper` — three declarations of one path. Vite
	// parses an imported .json into a module, which is what the sprawl dataset
	// needs: the component reads the data, not a link to it.
	resolve: { alias: { '#assets': fileURLToPath(new URL('../../assets', import.meta.url)) } },
	optimizeDeps: { exclude: ['@lightsout/engine', '@lightsout/shared'] },
	plugins: [markdownAsText(), tanstackStart(), tailwindcss(), viteReact()],
});
