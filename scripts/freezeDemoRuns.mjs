import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRunView } from '../packages/engine/src/views/getRunView.ts';
import { listRuns } from '../packages/engine/src/views/listRuns.ts';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Freezes three of this repo's own runs into `assets/demo-runs/`, which is what
 * the site's proof section renders and what a build holding no repo serves as
 * its runs list.
 *
 * The proof section shows the REAL run detail components, so it needs real run
 * views; a hand-written fixture would be a picture of the product rather than
 * the product. `.lightsout/` is gitignored, so the runs are a LOCAL-ONLY input
 * and the four JSON files are the committed output — build this on the machine
 * carrying the run history and commit it from there.
 *
 * Three slots, each picked by what the frame has to show rather than by id: run
 * ids are local to one machine, so the criteria are the only durable statement
 * of the choice. Which id filled each slot is logged, so a reader of the diff
 * can audit it.
 *
 *   implement — a passed implement run with every step passed, the most steps
 *   refactor  — a passed refactor run with a real measured before/after
 *   stopped   — the most recent implement or refactor run that failed or escalated
 *
 * The engine is reached by importing the MODULE FILES rather than the package:
 * Node strips TypeScript types without a flag from 22.18 on and resolves the
 * `#src/*` imports inside them from the engine's own manifest, but the package
 * index's graph reaches the pipeline's `.md` prompt modules, which plain Node
 * cannot load. `views/` does not. The repo root also declares no dependency on
 * the engine, so the bare specifier would not resolve here anyway.
 *
 * Never hand-edit the output. Run `pnpm build:demo-runs` instead.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The ceiling one frozen view may weigh.
 *
 * `RunView` carries no prompt or model output — the `agents/` transcripts the
 * manifest points at are never read into it — and this is what keeps a field
 * added later from quietly publishing one. A view this large is a transcript
 * that arrived, and the script stops rather than committing it.
 */
const maxViewBytes = 512 * 1024;

/** Every readable manifest under `.lightsout/runs/`, with the run's directory beside it. */
const readManifests = () => {
	const runsDir = join(repoRoot, '.lightsout', 'runs');

	if (!existsSync(runsDir)) {
		throw new Error('no .lightsout/runs/ here — the demo runs are frozen from this repo’s own run history');
	}

	const manifests = [];

	for (const entry of readdirSync(runsDir)) {
		const runDir = join(runsDir, entry);

		try {
			manifests.push({ runDir, manifest: JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')) });
		} catch {
			// A directory mid-write or a manifest someone truncated is not a
			// candidate; the reader that lists runs skips one the same way.
		}
	}

	return manifests;
};

/** The batch reports a refactor run recorded — the shape is what says a step was a batch, since the manifest stores reports opaquely. */
const readBatchReports = ({ manifest }) => (manifest.steps ?? []).map((step) => step.report).filter((report) => Array.isArray(report?.remainingSiteKeys));

/**
 * How many blocking sites the run actually cleared: what its work-list froze at
 * the start, less what its batches left standing.
 *
 * The frame exists to show the strongest before/after, so this is what the
 * refactor slot is chosen on.
 */
const measureBurnDown = ({ runDir, manifest }) => {
	const worklistPath = join(runDir, 'worklist.json');

	if (!existsSync(worklistPath)) {
		return undefined;
	}

	let worklist;

	try {
		worklist = JSON.parse(readFileSync(worklistPath, 'utf8'));
	} catch {
		return undefined;
	}

	const batches = worklist.batches ?? [];
	const reports = readBatchReports({ manifest });

	// Two batches and two reports, so the frame shows a burn-down rather than a
	// single job. Nothing is asked of the remaining counts themselves: a refactor
	// run only passes once every batch resolved, so on every passed run they are
	// all zero — the before/after this measures is the work-list against that.
	if (batches.length < 2 || reports.length < 2) {
		return undefined;
	}

	const blocking = batches.reduce((total, batch) => total + (batch.blocking?.length ?? 0), 0);
	const remaining = reports.reduce((total, report) => total + report.remainingSiteKeys.length, 0);

	return blocking - remaining;
};

/** Newest first, so a tie is broken by the run a reader would recognize. */
const byNewest = (first, second) => String(second.manifest.updatedAt).localeCompare(String(first.manifest.updatedAt));

/** Every step passed, not just the run — a run that passed with a step retried into submission is not the clean one. */
const isCleanImplement = ({ manifest }) =>
	manifest.pipeline === 'implement' && manifest.status === 'passed' && (manifest.steps ?? []).every((step) => step.status === 'passed');

/** Passed implement runs with every step passed, the one carrying the most steps first. */
const rankImplement = ({ manifests }) =>
	manifests
		.filter(isCleanImplement)
		.sort((first, second) => (second.manifest.steps?.length ?? 0) - (first.manifest.steps?.length ?? 0) || byNewest(first, second));

/** Passed refactor runs whose work-list and reports show a real before and after, the largest measured drop first. */
const rankRefactor = ({ manifests }) =>
	manifests
		.filter(({ manifest }) => manifest.pipeline === 'refactor' && manifest.status === 'passed')
		.map((candidate) => ({ ...candidate, drop: measureBurnDown(candidate) }))
		.filter((candidate) => candidate.drop !== undefined)
		.sort((first, second) => second.drop - first.drop || byNewest(first, second));

/**
 * Runs that stopped, most recent first.
 *
 * Only the two pipelines the other slots use: a coordinator or a coverage run
 * reads differently in the frame, and the three panels are meant to differ by
 * how the run ended rather than by what shape it is.
 */
const rankStopped = ({ manifests }) =>
	manifests
		.filter(
			({ manifest }) =>
				(manifest.pipeline === 'implement' || manifest.pipeline === 'refactor') && (manifest.status === 'failed' || manifest.status === 'escalated'),
		)
		.sort(byNewest);

/**
 * The first ranked candidate whose view this engine can still assemble.
 *
 * A manifest written before a config key was renamed no longer parses, and this
 * repo's history is long enough to hold several. Skipping one is not a silent
 * downgrade — the run that fills the slot is logged, and every skip is logged
 * with the reason — while failing on it would freeze the choice to whichever
 * runs happen to predate the last rename.
 */
const freezeSlot = async ({ slug, candidates, log }) => {
	for (const { manifest } of candidates) {
		try {
			return await getRunView({ cwd: repoRoot, runId: manifest.runId });
		} catch (error) {
			// Collapsed to one line: a manifest that fails its schema throws with the whole issue list in its message.
			const reason = String(error instanceof Error ? error.message : error)
				.replace(/\s+/g, ' ')
				.slice(0, 160);

			log(`${slug} — skipping run ${String(manifest.runId).slice(0, 8)}: ${reason}`);
		}
	}

	return undefined;
};

/** @param log - where progress goes; the caller owns the console so the function stays testable */
export const freezeDemoRuns = async ({ log = console.log } = {}) => {
	const manifests = readManifests();
	const ranked = {
		implement: rankImplement({ manifests }),
		refactor: rankRefactor({ manifests }),
		stopped: rankStopped({ manifests }),
	};
	const views = {};

	for (const [slug, candidates] of Object.entries(ranked)) {
		views[slug] = await freezeSlot({ slug, candidates, log });
	}

	const empty = Object.keys(views).filter((slug) => views[slug] === undefined);

	if (empty.length > 0) {
		throw new Error(`no run in this repo qualifies for: ${empty.join(', ')} — nothing was written`);
	}

	// Everything is serialised and weighed before anything is written, so a view
	// that turns out to carry a transcript leaves the committed fixtures as they
	// were rather than half-replaced.
	const files = Object.entries(views).map(([slug, view]) => {
		const json = `${JSON.stringify(view, undefined, 2)}\n`;

		if (json.length > maxViewBytes) {
			throw new Error(
				`${slug} run ${view.listing.shortId} froze to ${(json.length / 1024).toFixed(0)} KB, past the ${maxViewBytes / 1024} KB ceiling — a transcript reached the view`,
			);
		}

		return { slug, view, json };
	});
	const frozen = new Set(files.map(({ view }) => view.listing.runId));
	const listings = (await listRuns({ cwd: repoRoot })).filter((listing) => frozen.has(listing.runId));
	const outputDir = join(repoRoot, 'assets', 'demo-runs');

	mkdirSync(outputDir, { recursive: true });

	for (const { slug, view, json } of files) {
		writeFileSync(join(outputDir, `${slug}.json`), json);
		log(`${slug} — run ${view.listing.shortId} · ${view.listing.title} · ${(json.length / 1024).toFixed(0)} KB`);
	}

	writeFileSync(join(outputDir, 'listings.json'), `${JSON.stringify(listings, undefined, 2)}\n`);
	log(`wrote assets/demo-runs/ — three runs and ${listings.length} listing row(s)`);

	return { views, listings };
};

/**
 * Exit codes are set rather than forced with `process.exit`, for the reason
 * checkShipped.mjs states: stdout is a pipe for every caller that matters, and
 * exiting on the line after a log discards it.
 */
const main = async () => {
	try {
		await freezeDemoRuns();
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
