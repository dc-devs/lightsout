import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, type DecisionsRecord } from '#src/contracts/index.ts';
import { syncGlobalConstraints } from '#src/plan/sections/index.ts';

// Every file of a deliverable carries the same constraints, because a phase file
// is handed to an implementing agent on its own: a phase that pointed elsewhere
// for the rules binding it would be read without them. The sync is safe to
// repeat, so a file already holding the rendered section is reported unchanged
// rather than rewritten.

/** One decision row; only the fields a test varies are parameters. */
const decisionRow = ({
	question,
	choice,
	source = DecisionSource.Elicitation,
}: {
	question: string;
	choice: string;
	source?: DecisionSource;
}): DecisionRow => ({ source, question, options: 'this / that', choice, rationale: 'because it is the cheaper of the two', assumption: false });

/** Two constraint rows and one ordinary decision, so a rendering that ignored the prefix is visible. */
const mixedRows: DecisionRow[] = [
	decisionRow({ question: 'Global constraint: every write goes through the store', choice: 'Every write goes through the store' }),
	decisionRow({ question: 'Who writes the log?', choice: 'The ordinary choice nobody constrained', source: DecisionSource.Grill }),
	decisionRow({ question: 'Global constraint: no new runtime dependency', choice: 'No new runtime dependency is added' }),
];

/** A plan file carrying a hand-written constraints section the engine is about to take over, plus the headings either side of it. */
const planBody = ({ title, constraints = '- whatever the writer typed here before the engine owned the section.' }: { title: string; constraints?: string }) =>
	`# ${title}

## Context

Why this plan exists.

## Global Constraints

${constraints}

## Verification

- \`true\` — types clean
`;

/** The `## Global Constraints` body — its heading through the line before the next `##` heading. */
const constraintsSection = ({ text }: { text: string }) => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line.startsWith('## Global Constraints'));

	if (start === -1) {
		return '';
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex((line) => line.startsWith('## '));

	return (next === -1 ? rest : rest.slice(0, next)).join('\n');
};

/** The section's bullet lines — what a reader acts on, with the lead-in prose left out. */
const bulletLines = ({ section }: { section: string }) => section.split('\n').filter((line) => line.startsWith('- '));

/** Each reported file keyed by its basename, so an assertion pins what happened rather than the walk's order. */
const updatedByFile = ({ files }: { files: { path: string; updated: boolean }[] }) =>
	Object.fromEntries(files.map((file) => [basename(file.path), file.updated]));

/**
 * A deliverable of three plan files on disk. `prime` runs one sync first, so a
 * later act meets files the record already matches; `stale` then re-types one
 * file's section by hand, which is the only difference between the two.
 */
const setupDeliverable = async ({ prime = false, stale }: { prime?: boolean; stale?: string } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-constraints-'));
	const bases = ['overview.md', 'phase1-core.md', 'phase2-wire.md'];
	const titles: Record<string, string> = {
		'overview.md': 'Overview',
		'phase1-core.md': 'Phase 1 — Core',
		'phase2-wire.md': 'Phase 2 — Wire',
	};

	for (const base of bases) {
		writeFileSync(join(dir, base), planBody({ title: titles[base] ?? base }), 'utf8');
	}

	const decisions: DecisionsRecord = { planName: 'global-constraints', decisions: mixedRows };
	const paths = bases.map((base) => join(dir, base));

	if (prime) {
		await syncGlobalConstraints({ planPaths: paths, decisions });
	}

	if (stale !== undefined) {
		writeFileSync(join(dir, stale), planBody({ title: titles[stale] ?? stale }), 'utf8');
	}

	return { bases, paths, decisions, readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};

/** A plan file carrying the Decision Log the constraints section is placed below, and no constraints section for the sync to replace. */
const planWithoutConstraints = ({ title }: { title: string }) => `# ${title}

## Context

Why this plan exists.

## Decision Log

Composed by \`lightsout plan sync-decisions\`. Do not edit by hand.

## Verification

- \`true\` — types clean
`;

/** One plan file on disk carrying no constraints section at all, so the sync has to place one rather than replace one. */
const setupUnanchoredFile = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-constraints-placed-'));
	const path = join(dir, 'plan.md');

	writeFileSync(path, planWithoutConstraints({ title: 'Plan' }), 'utf8');

	const decisions: DecisionsRecord = { planName: 'global-constraints', decisions: mixedRows };

	return {
		path,
		decisions,
		headings: () =>
			readFileSync(path, 'utf8')
				.split('\n')
				.filter((line) => line.startsWith('## ')),
		readFile: () => readFileSync(path, 'utf8'),
	};
};

describe('syncGlobalConstraints', () => {
	test("writes the same rendered constraints into every plan file and reports each file's outcome", async () => {
		const deliverable = await setupDeliverable();

		const result = await syncGlobalConstraints({ planPaths: deliverable.paths, decisions: deliverable.decisions });

		const sections = deliverable.bases.map((base) => constraintsSection({ text: deliverable.readFile(base) }));
		const first = sections[0] ?? '';
		// no file is left stale while a sibling is rewritten: the three sections are
		// the identical text, it carries a bullet for each constraint row and none
		// for the ordinary decision, and every file is reported rewritten
		expect({
			reported: updatedByFile({ files: result }),
			everySectionMatchesTheFirst: sections.every((section) => section === first),
			bullets: bulletLines({ section: first }).length,
			carriesFirstConstraint: first.includes('Every write goes through the store'),
			carriesSecondConstraint: first.includes('No new runtime dependency is added'),
			carriesOrdinaryDecision: first.includes('The ordinary choice nobody constrained'),
		}).toStrictEqual({
			reported: { 'overview.md': true, 'phase1-core.md': true, 'phase2-wire.md': true },
			everySectionMatchesTheFirst: true,
			bullets: 2,
			carriesFirstConstraint: true,
			carriesSecondConstraint: true,
			carriesOrdinaryDecision: false,
		});
	});

	test('reports a matching file unchanged while rewriting the sibling that differs', async () => {
		const deliverable = await setupDeliverable({ prime: true, stale: 'phase2-wire.md' });
		const beforeMatching = ['overview.md', 'phase1-core.md'].map((base) => deliverable.readFile(base));

		const result = await syncGlobalConstraints({ planPaths: deliverable.paths, decisions: deliverable.decisions });

		// only the hand-re-typed file differs from the record, so only it is
		// reported rewritten — and the two files already matching keep every byte
		expect({
			reported: updatedByFile({ files: result }),
			matchingTexts: ['overview.md', 'phase1-core.md'].map((base) => deliverable.readFile(base)),
			staleSectionRewritten:
				constraintsSection({ text: deliverable.readFile('phase2-wire.md') }) === constraintsSection({ text: deliverable.readFile('overview.md') }),
		}).toStrictEqual({
			reported: { 'overview.md': false, 'phase1-core.md': false, 'phase2-wire.md': true },
			matchingTexts: beforeMatching,
			staleSectionRewritten: true,
		});
	});

	test('places a missing constraints section immediately below the Decision Log it is anchored on', async () => {
		const file = setupUnanchoredFile();

		const result = await syncGlobalConstraints({ planPaths: [file.path], decisions: file.decisions });

		// the file carries no section to replace, so the anchor alone decides where
		// the rules land: below the composed Decision Log and above the sections the
		// writer put after it, with the rendered bullets actually in them
		expect({
			reported: updatedByFile({ files: result }),
			headings: file.headings(),
			bullets: bulletLines({ section: constraintsSection({ text: file.readFile() }) }),
		}).toStrictEqual({
			reported: { 'plan.md': true },
			headings: ['## Context', '## Decision Log', '## Global Constraints', '## Verification'],
			bullets: ['- Every write goes through the store', '- No new runtime dependency is added'],
		});
	});
});
