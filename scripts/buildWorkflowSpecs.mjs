import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWorkflowSpec } from '../packages/engine/src/commands/index.ts';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Writes `assets/plan-workflow.json`, `assets/implement-workflow.json` and
 * `assets/refactor-workflow.json` from the command catalog.
 *
 * These three files used to be hand-written specs sitting beside the catalog's
 * ancestors, which meant a step's wording could say one thing in the README's
 * infographic and another on the command's own page. They are generated now, so
 * the graphic and the page cannot disagree. They stay on disk because
 * `.claude/skills/flow-graphic/scripts/build_graphic.py` takes a file.
 *
 * The engine is reached through the `commands` module's own barrel rather than
 * the package, for the reason buildDefaultPackView.mjs states: the package
 * index's graph reaches `.md` prompt modules plain Node cannot load, and the
 * repo root declares no engine dependency for a bare specifier to resolve
 * against. `commands/` imports no markdown, which is what makes this import
 * work under Node's unflagged type stripping.
 *
 * `--check` writes nothing and fails when a file on disk differs from what the
 * catalog would render, which is what keeps the committed specs honest. It is
 * wired into `pnpm check`.
 *
 * Never hand-edit the output. Run `pnpm build:workflow-specs` instead.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The commands that have an infographic, and the asset each one writes. */
const graphicCommands = ['plan', 'implement', 'refactor'];

/** The spec JSON one command's asset should hold, trailing newline included. */
const buildSpecJson = ({ id }) => `${JSON.stringify(renderWorkflowSpec({ id }), undefined, 2)}\n`;

/** The asset path for a command, relative to the repo root. */
const specPath = ({ id }) => join('assets', `${id}-workflow.json`);

/**
 * Exit codes are set rather than forced with `process.exit`, for the reason
 * checkShipped.mjs states: stdout is a pipe for every caller that matters, and
 * exiting on the line after a log discards it.
 */
const main = () => {
	const checking = process.argv.includes('--check');
	const stale = [];

	try {
		for (const id of graphicCommands) {
			const path = specPath({ id });
			const json = buildSpecJson({ id });

			if (!checking) {
				writeFileSync(join(repoRoot, path), json);
				console.log(`wrote ${path}`);
			} else if (readFileSync(join(repoRoot, path), 'utf8') !== json) {
				stale.push(path);
			}
		}
	} catch (error) {
		console.error('');
		console.error(`  ${error instanceof Error ? error.message : String(error)}`);
		console.error('');
		process.exitCode = 1;

		return;
	}

	if (stale.length > 0) {
		console.error('');
		console.error(`  ${stale.join(', ')} no longer matches the command catalog.`);
		console.error('  These are what the README infographics are rendered from.');
		console.error('');
		console.error('    pnpm build:workflow-specs && git add assets/');
		console.error('');
		process.exitCode = 1;

		return;
	}

	if (checking) {
		console.log('assets/*-workflow.json match the command catalog');
	}
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	main();
}
