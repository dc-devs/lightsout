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
	// A plain literal: this app is started by hand, so there is no environment to
	// read a port out of.
	server: { port: 4317 },
	// Every workspace package this app reaches ships TypeScript source, so Vite
	// has to transform them rather than hand them to Node. The engine's own
	// third-party dependencies stay external and resolve at run time from where
	// pnpm installed them, beside the engine.
	ssr: { noExternal: [/^@lightsout\//] },
	optimizeDeps: { exclude: ['@lightsout/engine', '@lightsout/shared'] },
	plugins: [markdownAsText(), tanstackStart(), tailwindcss(), viteReact()],
});
