import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConfigKeyReference } from '../packages/engine/src/views/renderConfigKeyReference.ts';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Writes the top-level key table of `docs/configuration.md` from the engine's
 * own `configKeyDescriptions`.
 *
 * That table used to be hand-written beside the same sentences the web app's
 * Config page reads, so adding a config key meant remembering to edit both and
 * nothing failed when only one was edited. The `queue` block is what proved it:
 * documented here, missing from the constant entirely.
 *
 * Only the table is generated. The region is bounded by a pair of HTML comments
 * so the prose around it stays hand-written — invisible on the site, because
 * react-markdown runs there without rehype-raw, and a comment survives every
 * markdown tool a heading-bounded region would not.
 *
 * The engine is reached by importing the renderer's own module file rather than
 * the views barrel, for the reason buildDefaultPackView.mjs states: the barrel's
 * graph reaches `.md` prompt modules that plain Node cannot load, and the
 * renderer's own graph does not.
 *
 * `--check` writes nothing and fails when the committed document differs from
 * what this would write, which is what keeps the table in step with the
 * constant. It is wired into `pnpm check`.
 *
 * Never hand-edit the generated region. Run `pnpm build:config-reference`
 * instead.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The document whose key reference is generated, repo-relative. */
const documentPath = 'docs/configuration.md';

/** The comment pair bounding the generated region — invisible on the site, which renders markdown without rehype-raw. */
const openMarker = '<!-- generated:config-key-reference -->';
const closeMarker = '<!-- /generated:config-key-reference -->';

/** How many times a marker appears, which is the only thing that makes a splice safe. */
const countMarker = ({ text, marker }) => text.split(marker).length - 1;

/**
 * The document text with its generated region replaced by the current table.
 *
 * @param text - the document as committed
 * @returns the text the committed file should hold
 * @throws {Error} When either marker is missing, appears more than once, or the closing one comes first — a generator that cannot find its region and appends anyway silently doubles the reference.
 */
export const buildConfigKeyReference = ({ text }) => {
	for (const marker of [openMarker, closeMarker]) {
		const count = countMarker({ text, marker });

		if (count !== 1) {
			throw new Error(`${documentPath} holds ${count} copies of ${marker} — it must hold exactly one`);
		}
	}

	const openIndex = text.indexOf(openMarker);
	const closeIndex = text.indexOf(closeMarker);

	if (closeIndex < openIndex) {
		throw new Error(`${documentPath} holds ${closeMarker} before ${openMarker} — the region is inside out`);
	}

	const before = text.slice(0, openIndex);
	const after = text.slice(closeIndex + closeMarker.length);

	return `${before}${openMarker}\n\n${renderConfigKeyReference()}\n\n${closeMarker}${after}`;
};

/**
 * Exit codes are set rather than forced with `process.exit`, for the reason
 * checkShipped.mjs states: stdout is a pipe for every caller that matters, and
 * exiting on the line after a log discards it.
 */
const main = () => {
	const checking = process.argv.includes('--check');

	try {
		const onDisk = readFileSync(join(repoRoot, documentPath), 'utf8');
		const text = buildConfigKeyReference({ text: onDisk });

		if (!checking) {
			writeFileSync(join(repoRoot, documentPath), text);
			console.log(`wrote ${documentPath}`);

			return;
		}

		if (onDisk === text) {
			console.log(`${documentPath} matches configKeyDescriptions`);

			return;
		}

		console.error('');
		console.error(`  ${documentPath}'s key reference no longer matches configKeyDescriptions.`);
		console.error('  It is the table every reader of the configuration page meets first.');
		console.error('');
		console.error(`    pnpm build:config-reference && git add ${documentPath}`);
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
	main();
}
