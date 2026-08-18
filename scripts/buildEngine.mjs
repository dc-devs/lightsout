import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Build the shipped engine from `packages/engine/src/`.
 *
 * `plugin/dist/cli.mjs` is what users actually run — marketplace installs copy
 * only the plugin directory, never `src/`. Like `plugin/standards/`, it is
 * committed: there is no install hook that could produce it later.
 *
 * The esbuild options live here rather than inline in package.json so there is
 * one definition of what the shipped engine is. `scripts/checkShipped.mjs`
 * builds through this same function to ask whether the committed file is
 * current — a check that spelled the options out a second time could pass
 * while building something subtly different from what ships.
 *
 * `--out <file>` builds somewhere else instead, which is how that check
 * rebuilds without writing over the file it is asking about.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const enginePackage = join(repoRoot, 'packages', 'engine');

export const buildEngine = async ({ out }) =>
	build({
		entryPoints: [join(enginePackage, 'src', 'main.ts')],
		// Pinned, because esbuild writes each bundled module's path into the output
		// as a comment, relative to this directory. Left to default to
		// process.cwd(), the same source would build to different bytes depending
		// on where the command was run from — and the committed bundle would look
		// stale to anyone who ran it from a subdirectory.
		//
		// Pinned to the engine package rather than the repo root because that is
		// the thing being built: the comments then read `src/...`, and stay that
		// way if the package is ever built on its own.
		absWorkingDir: enginePackage,
		bundle: true,
		platform: 'node',
		format: 'esm',
		loader: { '.md': 'text' },
		// The bundle is ESM, but some dependency reaches for CommonJS `require`
		// at run time. This hands it one built from the module's own URL.
		banner: { js: "import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);" },
		outfile: out,
		logLevel: 'error',
	});

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	const outFlag = process.argv.indexOf('--out');

	// The exit code is set rather than forced with `process.exit`: stdout is a
	// pipe for every caller that matters, writes to a pipe are asynchronous, and
	// exiting on the line after a log discards it.
	if (outFlag !== -1 && process.argv[outFlag + 1] === undefined) {
		console.error('--out needs a file path');
		process.exitCode = 1;
	} else {
		const out = outFlag === -1 ? join(repoRoot, 'plugin', 'dist', 'cli.mjs') : resolve(process.argv[outFlag + 1]);

		await buildEngine({ out });

		console.log(`built engine → ${out.replace(`${repoRoot}/`, '')}`);
	}
}
