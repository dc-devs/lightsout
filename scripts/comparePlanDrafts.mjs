import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { invokedDirectly } from './invokedDirectly.mjs';
import { runScript } from './runScript.mjs';

/**
 * Prints one before/after comparison of two plan folders.
 *
 *     node scripts/comparePlanDrafts.mjs <before-folder> <after-folder>
 *
 * The generated Decision Log and the dedicated contract template are a bet that an engine-composed plan costs less to draft and to review without
 * losing requirements. The figures that settle it already exist, spread across each folder's harness stream files and its grade.json; this reads them
 * side by side. Each argument is a directory holding plan.md, or overview.md and its phase files, resolved against the working directory.
 *
 * The script writes nothing, anywhere, ever — the folders it reads are the record of past runs, and a measurement tool that repairs its subject
 * measures the repair. It spawns no agent, makes no network call, and depends on nothing but `node:` builtins and the sibling scripts
 * invokedDirectly.mjs and runScript.mjs, so it runs against a worktree that has installed nothing.
 */

/** What a figure reads as when it was never measured — which is not the same as measuring zero. */
const unavailable = 'n/a';

/** One `*-stream.jsonl` file's result events, the only event kind carrying a run's cost and elapsed time. */
const readResultEvents = ({ path }) => {
	const events = [];

	for (const line of readFileSync(path, 'utf8').split('\n')) {
		try {
			const event = JSON.parse(line);

			if (typeof event === 'object' && event !== null && event.type === 'result') {
				events.push(event);
			}
		} catch {
			// A harness stream ends mid-line whenever a run was killed, and one bad line never voids a comparison.
		}
	}

	return events;
};

/** Cost and elapsed time summed across the folder's streams whose name starts with one of `prefixes`. */
const sumStreams = ({ folder, prefixes }) => {
	const names = readdirSync(folder).filter((name) => name.endsWith('-stream.jsonl') && prefixes.some((prefix) => name.startsWith(prefix)));
	let costUsd = 0;
	let durationMs = 0;

	for (const name of names) {
		for (const event of readResultEvents({ path: join(folder, name) })) {
			const elapsed = typeof event.duration_ms === 'number' ? event.duration_ms : event.duration_api_ms;

			costUsd += typeof event.total_cost_usd === 'number' ? event.total_cost_usd : 0;
			durationMs += typeof elapsed === 'number' ? elapsed : 0;
		}
	}

	return { costUsd, durationMs };
};

/** Every plan file in the folder: a single plan, or an overview and its phases. */
const readPlanFiles = ({ folder }) => {
	const isPlanFile = ({ name }) => name === 'plan.md' || name === 'overview.md' || (name.startsWith('phase') && name.endsWith('.md'));

	return readdirSync(folder)
		.filter((name) => isPlanFile({ name }))
		.map((name) => ({ name, text: readFileSync(join(folder, name), 'utf8') }));
};

/**
 * One plan file's prose as normalized sentences of eight words or more. Fenced blocks go first: a command line or a template excerpt is quoted
 * material, not prose the writer typed twice. Case, backticks and run-length of whitespace are normalized away so formatting alone cannot hide a repeat.
 */
const normalizeSentences = ({ text }) => {
	const prose = [];
	let fenced = false;

	for (const line of text.split('\n')) {
		if (line.trim().startsWith('```')) {
			fenced = !fenced;
		} else if (!fenced) {
			prose.push(line);
		}
	}

	const normalize = ({ piece }) => piece.toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();

	return prose
		.join(' ')
		.split(/[.!?](?=\s|$)/)
		.map((piece) => normalize({ piece }))
		.filter((sentence) => sentence.split(' ').filter((word) => word !== '').length >= 8);
};

/** How much of the folder's prose is said more than once, as a repeat count and a character total. */
const countDuplicatedText = ({ files }) => {
	const counts = new Map();
	let repeats = 0;
	let characters = 0;

	for (const file of files) {
		for (const sentence of normalizeSentences({ text: file.text })) {
			counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
		}
	}

	for (const [sentence, count] of counts) {
		repeats += count - 1;
		characters += (count - 1) * sentence.length;
	}

	return { repeats, characters };
};

/** The lines under `## <heading>`, up to the next `##` heading — the span one plan section owns. */
const sectionLines = ({ text, heading }) => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
	const rest = start === -1 ? [] : lines.slice(start + 1);
	const end = rest.findIndex((line) => line.trimStart().startsWith('##'));

	return end === -1 ? rest : rest.slice(0, end);
};

/** The folder's grade.json, or undefined when it was never graded or no longer parses. */
const readGradeReport = ({ folder }) => {
	const path = join(folder, 'grade.json');
	let report;

	try {
		const parsed = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;

		report = Array.isArray(parsed?.gaps) && Array.isArray(parsed?.structural) ? parsed : undefined;
	} catch {
		// A report that cannot be read is a report that was never taken, which the table says in its own cell.
	}

	return report;
};

/** How many requirements the plan states, and how many of them its grade found wanting. */
const readFidelity = ({ folder, files }) => {
	const countUnder = ({ text, heading, marker }) => sectionLines({ text, heading }).filter((line) => line.trimStart().startsWith(marker)).length;
	// Two of the acceptance table's `|` lines are its header and its separator, so only what follows them is a criterion.
	const countRows = ({ text }) => Math.max(countUnder({ text, heading: 'Acceptance Tests', marker: '|' }) - 2, 0);
	const countProse = ({ text }) => countUnder({ text, heading: 'Prose Files', marker: '-' });
	const blocking = ({ gaps }) => gaps.filter((gap) => gap.outcome === 'needs-a-human' || gap.outcome === 'unjudged').length;
	const report = readGradeReport({ folder });

	return {
		acceptanceRows: files.reduce((total, file) => total + countRows({ text: file.text }), 0),
		proseFiles: files.reduce((total, file) => total + countProse({ text: file.text }), 0),
		blockingGaps: report === undefined ? undefined : blocking({ gaps: report.gaps }),
		structuralFindings: report === undefined ? undefined : report.structural.length,
	};
};

/**
 * One folder's whole reading.
 * @throws {Error} When the path is not a directory, or holds no plan file at all.
 */
const readFolder = ({ path }) => {
	const files = existsSync(path) && statSync(path).isDirectory() ? readPlanFiles({ folder: path }) : [];

	if (files.length === 0) {
		throw new Error(`${path} is not a plan folder — expected a directory holding plan.md, or overview.md and its phase files.`);
	}

	return {
		label: basename(path),
		drafting: sumStreams({ folder: path, prefixes: ['draft-', 'repair-'] }),
		review: sumStreams({ folder: path, prefixes: ['grade-', 'dedup-'] }),
		duplication: countDuplicatedText({ files }),
		fidelity: readFidelity({ folder: path, files }),
	};
};

const formatCost = ({ value }) => `$${value.toFixed(2)}`;
const formatMinutes = ({ value }) => (value / 60_000).toFixed(1);
const formatCount = ({ value }) => String(value);
const formatCell = ({ value, format }) => (value === undefined ? unavailable : format({ value }));

/** The signed difference between the two folders, or the marker when either side was never measured. */
const formatChange = ({ before, after, format }) =>
	before === undefined || after === undefined ? unavailable : `${after < before ? '-' : '+'}${format({ value: Math.abs(after - before) })}`;

/** The metric rows in print order, each already rendered to the three cells the table prints. */
const buildRows = ({ before, after }) => {
	const metrics = [
		{ label: 'drafting cost', format: formatCost, of: ({ folder }) => folder.drafting.costUsd },
		{ label: 'drafting time', format: formatMinutes, of: ({ folder }) => folder.drafting.durationMs },
		{ label: 'review cost', format: formatCost, of: ({ folder }) => folder.review.costUsd },
		{ label: 'review time', format: formatMinutes, of: ({ folder }) => folder.review.durationMs },
		{ label: 'total cost', format: formatCost, of: ({ folder }) => folder.drafting.costUsd + folder.review.costUsd },
		{ label: 'total time', format: formatMinutes, of: ({ folder }) => folder.drafting.durationMs + folder.review.durationMs },
		{ label: 'duplicated sentences', format: formatCount, of: ({ folder }) => folder.duplication.repeats },
		{ label: 'duplicated characters', format: formatCount, of: ({ folder }) => folder.duplication.characters },
		{ label: 'acceptance-test rows', format: formatCount, of: ({ folder }) => folder.fidelity.acceptanceRows },
		{ label: 'prose files', format: formatCount, of: ({ folder }) => folder.fidelity.proseFiles },
		{ label: 'blocking gaps', format: formatCount, of: ({ folder }) => folder.fidelity.blockingGaps },
		{ label: 'structural findings', format: formatCount, of: ({ folder }) => folder.fidelity.structuralFindings },
	];

	return metrics.map(({ label, format, of }) => ({
		label,
		before: formatCell({ value: of({ folder: before }), format }),
		after: formatCell({ value: of({ folder: after }), format }),
		change: formatChange({ before: of({ folder: before }), after: of({ folder: after }), format }),
	}));
};

/** Writes the header, a rule, and one line per metric — each column padded to its widest cell. */
const printTable = ({ rows, before, after }) => {
	const header = ['metric', before.label, after.label, 'change'];
	const table = [header, ...rows.map((row) => [row.label, row.before, row.after, row.change])];
	const widths = header.map((_unused, column) => Math.max(...table.map((cells) => cells[column].length)));
	const line = ({ cells }) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[column]))).join('  ');
	const rule = widths.map((width) => '-'.repeat(width)).join('  ');

	console.log([line({ cells: header }), rule, ...table.slice(1).map((cells) => line({ cells }))].join('\n'));
};

/**
 * Reads both folders and prints the comparison.
 * @throws {Error} When a folder argument is missing, or names something that is not a plan folder.
 */
const main = () => {
	const [beforeArg, afterArg] = process.argv.slice(2);

	if (beforeArg === undefined || afterArg === undefined) {
		throw new Error(
			'usage: node scripts/comparePlanDrafts.mjs <before-folder> <after-folder>\n  Each argument is a plan folder: a directory holding plan.md, or overview.md and its phase files.',
		);
	}

	const before = readFolder({ path: resolve(beforeArg) });
	const after = readFolder({ path: resolve(afterArg) });

	printTable({ rows: buildRows({ before, after }), before, after });
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	runScript({ run: main });
}
