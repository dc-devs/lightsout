import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type DecisionRow, DecisionSource } from '#src/contracts/index.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

/**
 * The fixtures the Decision Log sync is exercised against: plan bodies whose
 * engine-composed sections are hand-written, the decision rows a sync renders
 * from, and the workspaces those two are combined into.
 *
 * Spelled here rather than in one test file because the sync has two test files
 * — the resolved-deliverable cases and the caller-supplied-path cases — and a
 * fixture that drifted between them would have the two suites arguing about
 * what a stale plan looks like.
 */

interface PlanBodyParams {
	title: string;
	/** The `## Global Constraints` body. Defaults to the template's absence spelling, which is what the engine composes from an empty record. */
	constraints?: string;
}

/** A plan file carrying a hand-written Decision Log the engine is about to take over, plus the heading that follows it. */
export const decisionLogPlanBody = ({ title, constraints = '- None' }: PlanBodyParams): string => `# ${title}

## Context

Why this plan exists.

## Decision Log

Whatever the writer typed here before the engine owned the section.

## Global Constraints

${constraints}

## Verification

- \`true\` — types clean
`;

interface DecisionRowParams {
	question: string;
	choice: string;
	source?: DecisionSource;
}

/** One decision row; only the fields a test varies are parameters. */
export const planDecisionRow = ({ question, choice, source = DecisionSource.Elicitation }: DecisionRowParams): DecisionRow => ({
	source,
	question,
	options: 'this / that',
	choice,
	rationale: 'because it is the cheaper of the two',
	assumption: false,
});

/** The two settled rows every fixture workspace's record holds unless the case varies them. */
export const twoDecisionRows: DecisionRow[] = [
	planDecisionRow({ question: 'Where does the log live?', choice: 'In the overview' }),
	planDecisionRow({ question: 'Who writes it?', choice: 'The engine, never a writer', source: DecisionSource.Grill }),
];

interface SeedParams {
	/** The plan's own folder — where its plan file(s) already went. */
	dir: string;
	/** Kebab plan name, which the record names as its own. */
	name: string;
	rows: DecisionRow[];
}

/** Write the plan's own `decisions.json` — the record the runner reads when it is handed none. */
export const seedPlanDecisions = ({ dir, name, rows }: SeedParams): void => {
	writeFileSync(join(dir, 'decisions.json'), JSON.stringify({ planName: name, decisions: rows }));
};

/** One `##` section's body — the lines below its heading, down to the line before the next `##` heading. */
export const planSectionBody = ({ text, heading }: { text: string; heading: string }): string => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));

	if (start === -1) {
		return '';
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex((line) => line.startsWith('## '));

	return (next === -1 ? rest : rest.slice(0, next)).join('\n');
};

/** The section's numbered table body rows — the header and separator rows have no integer first cell. */
export const decisionTableRows = ({ section }: { section: string }): string[] => section.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));

/** Each reported file keyed by its basename, so an assertion pins what happened rather than the walk's order. */
export const updatedByFile = ({ files }: { files: { path: string; updated: boolean }[] }): Record<string, boolean> =>
	Object.fromEntries(files.map((file) => [basename(file.path), file.updated]));

/** A single-file plan deliverable, with the decision record on disk unless the case is about its absence. */
export const setupDecisionLogPlan = ({ record = true }: { record?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'decision-log';
	const dir = writePlanDeliverable({ cwd, name, body: decisionLogPlanBody({ title: 'Decision Log' }) });
	const planPath = join(dir, 'plan.md');

	if (record) {
		seedPlanDecisions({ dir, name, rows: twoDecisionRows });
	} else {
		// the deliverable helper seeds an empty record beside every plan it writes,
		// and this case is about the record not being there at all
		rmSync(join(dir, 'decisions.json'));
	}

	return { cwd, name, readPlan: () => readFileSync(planPath, 'utf8') };
};

/** A phased deliverable of two phase files, with the overview beside them unless the case is about its absence. */
export const setupPhasedDecisionLogPlan = ({ overview = true }: { overview?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'phased-log';
	const phases = {
		'phase1-core.md': decisionLogPlanBody({ title: 'Phase 1 — Core' }),
		'phase2-wire.md': decisionLogPlanBody({ title: 'Phase 2 — Wire' }),
	};
	const files = overview ? { 'overview.md': decisionLogPlanBody({ title: 'Overview' }), ...phases } : phases;
	const dir = writePhasedPlanDeliverable({ cwd, name, files });

	seedPlanDecisions({ dir, name, rows: twoDecisionRows });

	return { cwd, name, path: (base: string) => join(dir, base), readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};

/** The workspace a phased draft holds between its overview spawn and its first phase file: `overview.md` alone, which resolves to no plan at all. */
export const setupOverviewOnlyPlan = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'mid-draft';
	const dir = writePhasedPlanDeliverable({ cwd, name, files: { 'overview.md': decisionLogPlanBody({ title: 'Overview' }) } });

	seedPlanDecisions({ dir, name, rows: twoDecisionRows });

	return { cwd, name, overviewPath: join(dir, 'overview.md'), readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};
