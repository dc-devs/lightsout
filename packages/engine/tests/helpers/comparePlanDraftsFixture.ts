import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const scriptPath = join(repoRoot, 'scripts', 'comparePlanDrafts.mjs');

// The twelve metric rows the table prints, each named by the words that tell it apart from the other eleven.
const costLabels = ['drafting cost', 'drafting time', 'review cost', 'review time', 'total cost', 'total time'] as const;
const contentLabels = ['duplicated sentences', 'duplicated characters', 'acceptance', 'prose', 'blocking', 'structural'] as const;

export const metricLabels = [...costLabels, ...contentLabels];

/** Nine words, so the duplication scan keeps it, and 55 characters once normalized. */
export const nineWordSentence = 'The engine composes the decision log from saved records.';
/** Seven words, so the duplication scan drops it however often it repeats. */
export const sevenWordSentence = 'This short line repeats in both files.';

/** One harness stream event of the only kind the script reads. */
export const resultLine = ({ costUsd, durationMs }: { costUsd: number; durationMs: number }) =>
	JSON.stringify({ type: 'result', total_cost_usd: costUsd, duration_ms: durationMs });

/** A plan file whose opening sentence carries its heading, so it can never collide with another fixture file's. */
const planText = ({ heading, body }: { heading: string; body: string }) =>
	`# ${heading}\n\n${heading} keeps an opening paragraph that appears in no other fixture file at all. ${body}\n`;

/** A plan file with a counted acceptance-test table and a counted prose-file list. */
export const planWithFidelity = ({ heading, acceptance, prose }: { heading: string; acceptance: number; prose: number }) => {
	const header = ['| Criterion | Test file | Test name | Gate |', '|-----------|-----------|-----------|------|'];
	const rows = Array.from({ length: acceptance }, (_unused, index) => `| criterion ${index} | a.test.ts | name ${index} | test-unit |`);
	const bullets = Array.from({ length: prose }, (_unused, index) => `- \`docs/file-${index}.md\` — prose only`);
	const sections = [`# ${heading}`, '## Acceptance Tests', [...header, ...rows].join('\n'), '## Prose Files', bullets.join('\n')];

	return `${[...sections, '## Verification', '- pnpm check'].join('\n\n')}\n`;
};

export interface FolderShape {
	/** The folder's basename, which is also the column label the table prints for it. */
	name: string;
	/** Plan files, written verbatim under the folder. */
	files?: Record<string, string>;
	/** `*-stream.jsonl` files, one JSONL line per entry. */
	streams?: Record<string, string[]>;
	/** Written as grade.json; left off disk entirely when absent. */
	grade?: { structural: unknown[]; gaps: { outcome: string }[] };
	/** Written as grade.json verbatim, for the report that no longer parses; ignored when `grade` is given. */
	gradeText?: string;
}

type SingleFolderParams = { name: string; body?: string } & Omit<FolderShape, 'name' | 'files'>;

/** A single-plan folder, for the cases whose figures come from its streams or its grade rather than its prose. */
export const singleFolder = ({ name, body = 'It says one thing once.', ...rest }: SingleFolderParams): FolderShape => ({
	name,
	files: { 'plan.md': planText({ heading: name, body }) },
	...rest,
});

/** A phased folder whose two files carry the same body, so any repeat the scan finds inside it is that body's. */
export const phasedFolder = ({
	name,
	body,
	phaseBody = body,
	suffix = '',
}: {
	name: string;
	body: string;
	phaseBody?: string;
	suffix?: string;
}): FolderShape => ({
	name,
	files: {
		'overview.md': `${planText({ heading: `${name} overview`, body })}${suffix}`,
		'phase1-alpha.md': `${planText({ heading: `${name} phase one`, body: phaseBody })}${suffix}`,
	},
});

/** The second folder of a comparison whose own figures the case does not care about. */
export const plainAfter = singleFolder({ name: 'plain-after' });

/** $2.00 and 1.5 minutes of drafting, $3.00 and 3.0 of review, and a stream in neither prefix set holding $7.25 and 8.3. */
export const pricedStreams: Record<string, string[]> = {
	'draft-stream.jsonl': [resultLine({ costUsd: 1.5, durationMs: 60_000 })],
	'repair-1-stream.jsonl': [resultLine({ costUsd: 0.5, durationMs: 30_000 })],
	'grade-plan-surface-stream.jsonl': [resultLine({ costUsd: 2, durationMs: 120_000 })],
	'dedup-stream.jsonl': [resultLine({ costUsd: 1, durationMs: 60_000 })],
	'implement-stream.jsonl': [resultLine({ costUsd: 7.25, durationMs: 500_000 })],
};

const gapOutcomes = ['needs-a-human', 'needs-a-human', 'unjudged', 'unjudged', 'agent-can-decide', 'already-answered', 'already-answered'];

/** Seven gaps of which four — the needs-a-human and unjudged ones — block, beside five structural findings. */
export const gradedReport = { structural: ['a', 'b', 'c', 'd', 'e'].map((check) => ({ check })), gaps: gapOutcomes.map((outcome) => ({ outcome })) };

/**
 * Two throwaway plan folders under one temp root, and the three ways a case
 * reaches the script: run it, import it, and read back every byte it left.
 *
 * The fixture writes its own data rather than pointing at this repository's
 * `.lightsout/plans/`, because a test anchored on a real folder would change
 * its verdict every time a plan is drafted. The caller keeps the returned
 * `root` and removes it, the way the sprawl script tests keep theirs.
 */
export const setupComparePlanDrafts = ({ before, after }: { before: FolderShape; after: FolderShape }) => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-compare-plan-drafts-'));
	const shapes = [before, after];

	const writeFolder = ({ shape }: { shape: FolderShape }) => {
		const folder = join(root, shape.name);

		mkdirSync(folder, { recursive: true });

		for (const [name, text] of Object.entries(shape.files ?? {})) {
			writeFileSync(join(folder, name), text);
		}

		for (const [name, lines] of Object.entries(shape.streams ?? {})) {
			writeFileSync(join(folder, name), `${lines.join('\n')}\n`);
		}

		if (shape.grade !== undefined) {
			writeFileSync(join(folder, 'grade.json'), `${JSON.stringify(shape.grade, null, 2)}\n`);
		} else if (shape.gradeText !== undefined) {
			writeFileSync(join(folder, 'grade.json'), shape.gradeText);
		}

		return folder;
	};

	const beforePath = writeFolder({ shape: before });
	const afterPath = writeFolder({ shape: after });

	/** The script's verdict: whether it exited 0, with the streams kept apart so a table can be told from a complaint. */
	const run = ({ args = [beforePath, afterPath] }: { args?: string[] } = {}) => {
		const finished = spawnSync('node', [scriptPath, ...args], { encoding: 'utf8' });

		return { ok: finished.status === 0, stdout: finished.stdout ?? '', stderr: finished.stderr ?? '' };
	};

	/** Imports the script rather than running it and writes the exit code to stdout — stdout holding only that code is what proves nothing else ran. */
	const importModule = () => {
		const child = `await import(${JSON.stringify(`file://${scriptPath}`)}); process.stdout.write(String(process.exitCode));`;

		return execFileSync('node', ['--input-type=module', '-e', child], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	};

	/** Every file in both folders, keyed `<folder>/<file>` — the folders are flat, so one level is the whole tree. */
	const snapshot = () => {
		const entries = shapes.flatMap((shape) =>
			readdirSync(join(root, shape.name)).map((name) => [`${shape.name}/${name}`, readFileSync(join(root, shape.name, name), 'utf8')] as const),
		);

		return Object.fromEntries(entries);
	};

	return { root, beforePath, afterPath, run, importModule, snapshot };
};

/** The one printed line for each metric, so a cell assertion never has to guess at how wide a column was padded. */
export const readRows = ({ stdout }: { stdout: string }) => {
	const lines = stdout.split('\n');
	const rowFor = ({ label }: { label: string }) => lines.find((line) => new RegExp(`^\\s*${label}`, 'i').test(line)) ?? '';

	return Object.fromEntries(metricLabels.map((label) => [label, rowFor({ label })])) as Record<(typeof metricLabels)[number], string>;
};

/** One printed row split back into its four cells: the padding between them is always two spaces or more, and no cell holds two in a row. */
export const readCells = ({ row }: { row: string }) => row.trim().split(/\s{2,}/);
