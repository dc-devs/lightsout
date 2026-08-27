import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStandardsPackBundle } from '../packages/engine/src/views/getStandardsPackBundle.ts';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Writes `assets/default-pack.json`: the authored default pack read whole, its
 * prose and every fixture file's text included.
 *
 * The web app carries this because the engine's run-time default is the copy
 * `plugin/standards/` ships, which the bundler strips the fixtures out of. A
 * rule page has to show the code a rule argues about, so the app substitutes
 * this view wherever the engine finds that stripped copy — which is every repo
 * that is not this monorepo — and serves it outright on a public build holding
 * no repo at all.
 *
 * `rootPath` and `path` are rewritten to the repo-relative
 * `packages/standards-typescript`, the way freezeDemoRuns.mjs relativises a
 * plan path: the file is committed and compared byte for byte, so it may carry
 * nothing about the machine that wrote it. Neither field is ever printed for
 * the default pack — its header says "loads when you say nothing" instead.
 *
 * `--check` writes nothing and fails when the file on disk differs from what
 * this would write, which is what keeps the committed view in step with the
 * pack. It is wired beside `check:shipped` in CI and in the pre-push hook.
 *
 * The engine is reached by importing the module file rather than the package,
 * for the reason freezeDemoRuns.mjs states: the package index's graph reaches
 * `.md` prompt modules that plain Node cannot load, and `views/` does not.
 *
 * Never hand-edit the output. Run `pnpm build:default-pack` instead.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The name the authored pack answers to, and the one the app asks for. */
const defaultPackName = 'lightsout-defaults';

/** Where the authored pack sits in this monorepo, and what both path fields are rewritten to. */
const authoredPackPath = 'packages/standards-typescript';

const outputPath = join(repoRoot, 'assets', 'default-pack.json');

/** @returns the JSON text the committed file should hold, trailing newline included */
export const buildDefaultPackView = async () => {
	const bundle = await getStandardsPackBundle({ cwd: repoRoot, name: defaultPackName });

	if (bundle.built) {
		throw new Error(
			`${defaultPackName} resolved to the built copy at ${bundle.rootPath} — this script exists to capture the AUTHORED pack, which still has its fixtures`,
		);
	}

	return `${JSON.stringify({ ...bundle, rootPath: authoredPackPath, path: authoredPackPath }, undefined, 2)}\n`;
};

/**
 * Exit codes are set rather than forced with `process.exit`, for the reason
 * checkShipped.mjs states: stdout is a pipe for every caller that matters, and
 * exiting on the line after a log discards it.
 */
const main = async () => {
	const checking = process.argv.includes('--check');

	try {
		const json = await buildDefaultPackView();

		if (!checking) {
			writeFileSync(outputPath, json);
			console.log(`wrote assets/default-pack.json — ${(json.length / 1024).toFixed(0)} KB`);

			return;
		}

		const onDisk = readFileSync(outputPath, 'utf8');

		if (onDisk === json) {
			console.log('assets/default-pack.json matches packages/standards-typescript/');

			return;
		}

		console.error('');
		console.error('  assets/default-pack.json no longer matches packages/standards-typescript/.');
		console.error('  It is what the site and every viewer off this monorepo show for the default pack.');
		console.error('');
		console.error('    pnpm build:default-pack && git add assets/default-pack.json');
		console.error('');
		process.exitCode = 1;
	} catch (error) {
		console.error('');
		console.error(`  ${error instanceof Error ? error.message : String(error)}`);
		console.error('');
		process.exitCode = 1;
	}
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	await main();
}
