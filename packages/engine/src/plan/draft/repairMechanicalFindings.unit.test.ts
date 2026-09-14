import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, type DecisionsRecord, FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { repairMechanicalFindings } from '#src/plan/draft/index.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { overviewBody, phaseBody } from '#tests/helpers/phasePlan.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The deterministic pass: everything the engine owns — the Decision Log, the
// Global Constraints, the stamped phase counts and the paired phase row and
// declaration block — regenerated in code before a repair round lints, so an
// agent attempt is never spent on bookkeeping. Every other finding is left
// exactly as it was for the agent round that follows.

/** One merged decision row; only the two fields a criterion turns on are parameters. */
const decisionRow = ({ question, choice }: { question: string; choice: string }): DecisionRow => ({
	source: DecisionSource.Elicitation,
	question,
	options: 'this way / that way',
	choice,
	rationale: 'the cheaper of the two, and reversible',
	assumption: false,
});

/** The constraint choice the composed section has to carry, and the ordinary choice it must leave out. */
const constraintChoice = 'Every write goes through the store';
const ordinaryChoice = 'The engine renders the phase table from the phase record';

/** A record holding one plan-wide constraint and one ordinary decision, so a section composed from neither is visible. */
const settledDecisions = (): DecisionsRecord => ({
	planName: 'demo',
	decisions: [
		decisionRow({ question: 'Global constraint: every write goes through the store', choice: constraintChoice }),
		decisionRow({ question: 'Who owns the phase table?', choice: ordinaryChoice }),
	],
});

/** The record with no rows — what the shared bodies already render their own Decision Log from, so nothing about the log is stale. */
const noDecisions = (): DecisionsRecord => ({ planName: 'demo', decisions: [] });

/** One `##` section's body: the lines under its heading, up to the next `##` heading. */
const sectionOf = ({ text, heading }: { text: string; heading: string }) => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line === `## ${heading}`);

	if (start === -1) {
		return '';
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex((line) => line.startsWith('## '));

	return (next === -1 ? rest : rest.slice(0, next)).join('\n');
};

/** The same file with one `##` section removed outright — a section the engine has to compose back. */
const withoutSection = ({ text, heading }: { text: string; heading: string }) => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line === `## ${heading}`);

	if (start === -1) {
		return text;
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex((line) => line.startsWith('## '));

	return [...lines.slice(0, start), ...(next === -1 ? [] : rest.slice(next))].join('\n');
};

/**
 * Whether the lint still reports each of the four things the engine composes.
 * The `issue` wording is human-facing copy, so the two declaration halves are
 * told apart by a loose match rather than by pinning a sentence.
 */
const engineOwnedReported = ({ findings }: { findings: StructuralFinding[] }) => {
	const issuesFor = ({ check }: { check: StructuralCheck }) => findings.filter((finding) => finding.check === check).map((finding) => finding.issue);
	const declaration = issuesFor({ check: StructuralCheck.DeclarationConsistent });

	return {
		decisionLog: issuesFor({ check: StructuralCheck.DecisionLogCurrent }).length > 0,
		globalConstraints: issuesFor({ check: StructuralCheck.SectionsPresent }).some((issue) => issue.includes('Global Constraints')),
		phaseCounts: declaration.some((issue) => /is declared to/.test(issue)),
		phaseDeclarations: declaration.some((issue) => /file budget/.test(issue)),
	};
};

/** The checks whose fix is a judgment call no code can make — what the pass has to hand the agent untouched. */
const judgmentChecks = new Set<StructuralCheck>([StructuralCheck.PathExists, StructuralCheck.HandoffChained, StructuralCheck.DeclarationConsistent]);

/** Every judgment-dependent finding, in a stable order, reduced to the fields that identify it. */
const judgmentFindings = ({ findings }: { findings: StructuralFinding[] }) =>
	findings
		.filter((finding) => judgmentChecks.has(finding.check))
		.map(({ check, severity, phase, location }) => ({ check, severity, phase, location }))
		.sort((one, other) => JSON.stringify(one).localeCompare(JSON.stringify(other)));

/** Plant a file the plan claims already exists, so a `## Files to Modify` heading is not a broken reference. */
const plant = ({ cwd, paths }: { cwd: string; paths: string[] }) => {
	for (const path of paths) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), 'export const planted = 1;\n');
	}
};

/** A consumer repo holding a phased deliverable — an overview and its phase files — and the record the draft was started from. */
const setupPhasedDeliverable = ({
	overview,
	phases,
	decisions,
	existing = [],
}: {
	overview: string;
	phases: Record<string, string>;
	decisions: DecisionsRecord;
	existing?: string[];
}) => {
	const cwd = setupConsumerRepo();
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });
	plant({ cwd, paths: existing });

	const overviewPath = join(dir, 'overview.md');

	writeFileSync(overviewPath, overview);

	const phasePaths = Object.entries(phases).map(([base, body]) => {
		const path = join(dir, base);

		writeFileSync(path, body);

		return path;
	});
	const planPaths = [overviewPath, ...phasePaths];

	return {
		cwd,
		name: 'demo',
		decisions,
		planPaths,
		overviewPath,
		lint: () => lintPlanStructure({ cwd, planPaths, decisions }),
		read: ({ base }: { base: string }) => readFileSync(join(dir, base), 'utf8'),
	};
};

/** A consumer repo holding a single-file plan — no overview, so the deliverable has no phase table at all. */
const setupStandalonePlan = ({ body, decisions, existing = [] }: { body: string; decisions: DecisionsRecord; existing?: string[] }) => {
	const cwd = setupConsumerRepo();
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });
	plant({ cwd, paths: existing });

	const planPath = join(dir, 'plan.md');

	writeFileSync(planPath, body);

	return {
		cwd,
		name: 'demo',
		decisions,
		planPaths: [planPath],
		planPath,
		lint: () => lintPlanStructure({ cwd, planPaths: [planPath], decisions }),
		read: () => readFileSync(planPath, 'utf8'),
	};
};

describe('repairMechanicalFindings', () => {
	test('composes every engine-owned section of a phased deliverable', async () => {
		const deliverable = setupPhasedDeliverable({
			decisions: settledDecisions(),
			// the overview carries no Global Constraints section at all, an estimate
			// for both counts, and a file budget its phase file disagrees with
			overview: withoutSection({
				text: overviewBody({
					rows: [
						{ number: 1, file: 'phase1-core.md', created: 9, touched: 9, fileBudget: 9 },
						{ number: 2, file: 'phase2-wire.md', created: 9, touched: 9 },
					],
				}),
				heading: 'Global Constraints',
			}),
			phases: {
				'phase1-core.md': phaseBody({ create: ['src/one.ts'], modify: ['src/two.ts'], fileBudget: 4 }),
				'phase2-wire.md': phaseBody({ modify: ['src/two.ts'] }),
			},
			existing: ['src/two.ts'],
		});
		const before = engineOwnedReported({ findings: await deliverable.lint() });

		await repairMechanicalFindings({
			cwd: deliverable.cwd,
			name: deliverable.name,
			planPaths: deliverable.planPaths,
			decisions: deliverable.decisions,
			overviewPath: deliverable.overviewPath,
		});

		const after = engineOwnedReported({ findings: await deliverable.lint() });

		// the same lint over the same deliverable, either side of the pass: each of
		// the four is a defect the engine can settle from a record, so none of them
		// may still be there to spend an agent attempt on
		expect({ before, after }).toStrictEqual({
			before: { decisionLog: true, globalConstraints: true, phaseCounts: true, phaseDeclarations: true },
			after: { decisionLog: false, globalConstraints: false, phaseCounts: false, phaseDeclarations: false },
		});
	});

	test('renders the overview file budget from the phase file that declares it', async () => {
		const deliverable = setupPhasedDeliverable({
			decisions: noDecisions(),
			overview: overviewBody({ rows: [{ number: 1, file: 'phase1-core.md', created: 0, touched: 1, fileBudget: 9 }] }),
			phases: { 'phase1-core.md': phaseBody({ modify: ['src/two.ts'], fileBudget: 4 }) },
			existing: ['src/two.ts'],
		});

		await repairMechanicalFindings({
			cwd: deliverable.cwd,
			name: deliverable.name,
			planPaths: deliverable.planPaths,
			decisions: deliverable.decisions,
			overviewPath: deliverable.overviewPath,
		});

		const declarations = parsePhaseDeclarations({ plan: parsePlan({ content: deliverable.read({ base: 'overview.md' }), base: 'overview.md' }) });
		const phase = parsePlan({ content: deliverable.read({ base: 'phase1-core.md' }), base: 'phase1-core.md' });

		// the phase file is the copy the implementing agent is handed, so it is the
		// authoritative one — a pass that settled the disagreement the other way
		// round would leave both copies reading 9
		expect({ declared: declarations.map(({ file, fileBudget }) => ({ file, fileBudget })), ownBudget: phase.fileBudget }).toStrictEqual({
			declared: [{ file: 'phase1-core.md', fileBudget: 4 }],
			ownBudget: 4,
		});
	});

	test('composes the phases it has a file for when the overview declares one it does not', async () => {
		const deliverable = setupPhasedDeliverable({
			decisions: noDecisions(),
			// the second row names a file this deliverable does not have — what
			// `parsePhaseDeclarations` hands back rather than rejecting
			overview: overviewBody({
				rows: [
					{ number: 1, file: 'phase1-core.md', created: 0, touched: 1, fileBudget: 9 },
					{ number: 2, file: 'phase9-elsewhere.md', created: 4, touched: 4, fileBudget: 9 },
				],
			}),
			phases: { 'phase1-core.md': phaseBody({ modify: ['src/two.ts'], fileBudget: 4 }) },
			existing: ['src/two.ts'],
		});

		await repairMechanicalFindings({
			cwd: deliverable.cwd,
			name: deliverable.name,
			planPaths: deliverable.planPaths,
			decisions: deliverable.decisions,
			overviewPath: deliverable.overviewPath,
		});

		const declarations = parsePhaseDeclarations({ plan: parsePlan({ content: deliverable.read({ base: 'overview.md' }), base: 'overview.md' }) });

		// the budget substitution is defined only over rows a phase file was found
		// for, so the unmatched row never sends the pass looking for a file that is
		// not there — and the phase that does have one is still stamped from its own
		// file and given its own declared budget
		expect(declarations.find(({ file }) => file === 'phase1-core.md')).toEqual(
			expect.objectContaining({ file: 'phase1-core.md', fileBudget: 4, touchedCount: 1 }),
		);
	});

	test('composes only the decision log and the constraints for a standalone plan', async () => {
		const plan = setupStandalonePlan({
			decisions: settledDecisions(),
			body: phaseBody({ modify: ['src/two.ts'], reference: false }),
			existing: ['src/two.ts'],
		});
		const before = engineOwnedReported({ findings: await plan.lint() });

		// resolving at all is half the criterion: with no overview there is no
		// `## Phases` table to stamp, and a stamp attempted against this file would
		// reject on the overview path it was never given
		const written = await repairMechanicalFindings({
			cwd: plan.cwd,
			name: plan.name,
			planPaths: plan.planPaths,
			decisions: plan.decisions,
		});

		const after = plan.read();
		const constraints = sectionOf({ text: after, heading: 'Global Constraints' });
		const relinted = engineOwnedReported({ findings: await plan.lint() });

		expect({
			written: [...new Set(written.map(({ path }) => path))],
			decisionLog: { before: before.decisionLog, after: relinted.decisionLog },
			statesConstraint: constraints.includes(constraintChoice),
			statesOrdinaryDecision: constraints.includes(ordinaryChoice),
			hasPhasesTable: parsePlan({ content: after, base: 'plan.md' }).sections.has('Phases'),
		}).toStrictEqual({
			written: [plan.planPath],
			decisionLog: { before: true, after: false },
			statesConstraint: true,
			statesOrdinaryDecision: false,
			hasPhasesTable: false,
		});
	});

	test('leaves every judgment-dependent finding for the agent to repair', async () => {
		const deliverable = setupPhasedDeliverable({
			decisions: noDecisions(),
			// every count and budget already agrees with its phase file, so the only
			// declaration defect left is the one no code can settle
			overview: overviewBody({
				rows: [
					{ number: 1, file: 'phase1-core.md', created: 1, touched: 2 },
					{ number: 2, file: 'phase2-wire.md', created: 0, touched: 3, fileBudget: 1 },
				],
			}),
			phases: {
				'phase1-core.md': phaseBody({ create: ['src/one.ts'], modify: ['src/missing.ts'], handsForward: 'Exporting `handedExport`.' }),
				'phase2-wire.md': phaseBody({ modify: ['src/two.ts', 'src/three.ts', 'src/four.ts'], fileBudget: 1 }),
			},
			existing: ['src/two.ts', 'src/three.ts', 'src/four.ts'],
		});
		const surviving = [
			{
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				phase: 'overview.md',
				location: 'overview.md → Phase Declarations',
			},
			{
				check: StructuralCheck.HandoffChained,
				severity: FindingSeverity.Blocking,
				phase: 'phase2-wire.md',
				location: 'phase2-wire.md → Prerequisites',
			},
			{
				check: StructuralCheck.PathExists,
				severity: FindingSeverity.Blocking,
				phase: 'phase1-core.md',
				location: 'phase1-core.md → src/missing.ts',
			},
		];
		const before = judgmentFindings({ findings: await deliverable.lint() });

		await repairMechanicalFindings({
			cwd: deliverable.cwd,
			name: deliverable.name,
			planPaths: deliverable.planPaths,
			decisions: deliverable.decisions,
			overviewPath: deliverable.overviewPath,
		});

		const after = judgmentFindings({ findings: await deliverable.lint() });

		// a missing path, a hand-off nobody claims and a budget under the phase's own
		// work each need a choice between shrinking the phase and raising the number —
		// regenerating anything here would either paper one over or invent an answer
		expect({ before, after }).toStrictEqual({ before: surviving, after: surviving });
	});
});
