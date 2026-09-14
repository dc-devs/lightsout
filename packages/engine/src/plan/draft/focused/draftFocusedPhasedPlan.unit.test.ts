import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type DecisionsRecord, DraftImplementation, type PlanFacts, type SourceEvidenceIndex } from '#src/contracts/index.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import { selectPhaseEvidence } from '#src/plan/draft/focused/common/utils/selectPhaseEvidence.ts';
import { draftFocusedPhasedPlan } from '#src/plan/draft/focused/index.ts';
import type { PhaseDeclaration } from '#src/plan/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createScriptedDraftDriver, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The focused phased flow: the sections the engine composes from its own records
// before the closing lint reads them, and the repair agent seeing only what no
// record could settle. Plus the per-phase narrowing of the collected evidence.

/** The one settled rule the engine renders into every file's `## Global Constraints` — a bullet no writer body below ever types. */
const constraintChoice = 'Never log a secret.';

/** A decisions record carrying one `Global constraint:` row, so the composed section has a bullet the writer cannot have written. */
const draftDecisions = ({ planName }: { planName: string }): DecisionsRecord => ({
	planName,
	decisions: [
		{
			source: 'Elicitation',
			question: 'Global constraint: how are secrets handled?',
			options: 'log them / never log them',
			choice: constraintChoice,
			rationale: 'secrets in a transcript are secrets published',
			assumption: false,
		},
	],
});

/** Minimal verified facts — the flow reads them for the writer briefs, and no assertion here varies with them. */
const draftFacts = (): PlanFacts => ({
	request: 'add a focused drafting flow',
	areas: [],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-01-01T00:00:00.000Z',
});

/** One collected entry, so every focused spawn has a brief to carry. */
const draftEvidence = ({ planName }: { planName: string }): SourceEvidenceIndex => ({
	planName,
	entries: [
		{
			path: 'src/index.js',
			sha256: 'a'.repeat(64),
			kind: 'whole',
			bytes: 22,
			text: 'export const one = 1;\n',
			roles: ['the entry point the plan re-exports from'],
			definitions: [],
		},
	],
	collectedAt: '2026-01-01T00:00:00.000Z',
});

/** The clean phase body with its `## Global Constraints` section removed, so only the engine can put one back. */
const phaseWithoutConstraints = () => cleanPlanBody({ reference: true }).replace('## Global Constraints\n\n- None\n\n', '');

/** The clean phase body declaring its own `## File Budget`, with `placeholder` planting the one defect no record can settle. */
const phaseWithBudget = ({ placeholder = false }: { placeholder?: boolean } = {}) => {
	const body = cleanPlanBody({ reference: true }).replace('## Scope Boundaries', '## File Budget\n\n12\n\n## Scope Boundaries');

	return placeholder ? body.replace('A new module exporting', 'TBD — a new module exporting') : body;
};

/** A seeded workspace, a scripted harness, and the resolved context the focused phased flow takes. */
const setupFocusedPhasedDraft = ({ name, respond }: { name: string; respond: Parameters<typeof createScriptedDraftDriver>[0]['respond'] }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const planDir = join(cwd, '.lightsout', 'plans', name);
	const calls: { role: string; file: string; prompt: string }[] = [];
	const context: DraftContext = {
		cwd,
		driver: createScriptedDraftDriver({ onCall: (call) => calls.push(call), respond }),
		name,
		workspaceDir: planDir,
		facts: draftFacts(),
		decisions: draftDecisions({ planName: name }),
		implementation: DraftImplementation.Focused,
		evidence: draftEvidence({ planName: name }),
		executorFileLimit: 50,
		timeoutMs: 60_000,
		progress: () => undefined,
	};

	return { context, calls, planDir };
};

/** Two areas of one repository, each recording its own file, and one reference pattern under the second. */
const evidenceFacts = (): PlanFacts => ({
	request: 'split the drafting module',
	areas: [
		{
			area: 'alpha',
			affectedPackages: ['packages/alpha'],
			filesToModify: [{ path: 'packages/alpha/src/one.ts', role: 'the flow this phase edits' }],
			patternsToMirror: [],
			integrationPoints: [],
			scripts: [],
			namingConvention: 'camelCase',
		},
		{
			area: 'beta',
			affectedPackages: ['packages/beta'],
			filesToModify: [{ path: 'packages/beta/src/two.ts', role: 'another area entirely' }],
			patternsToMirror: [{ path: 'packages/beta/src/mirror.ts', takeaway: 'the shape every phase imitates' }],
			integrationPoints: [],
			scripts: [],
			namingConvention: 'camelCase',
		},
	],
	verification: { pathsChecked: 3, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-01-01T00:00:00.000Z',
});

/** One collected entry per path those facts record, in path order. */
const evidenceIndex = (): SourceEvidenceIndex => ({
	planName: 'demo',
	entries: ['packages/alpha/src/one.ts', 'packages/beta/src/mirror.ts', 'packages/beta/src/two.ts'].map((path) => ({
		path,
		sha256: 'b'.repeat(64),
		kind: 'whole' as const,
		bytes: 12,
		text: `// ${path}\n`,
		roles: [],
		definitions: [],
	})),
	collectedAt: '2026-01-01T00:00:00.000Z',
});

/** The narrowing inputs: those facts, that index, and a declaration creating whatever the case varies. */
const setupPhaseEvidence = ({ creates }: { creates: string[] }) => {
	const declaration: PhaseDeclaration = {
		number: 1,
		file: 'phase1-alpha.md',
		scope: 'the alpha work',
		createdCount: creates.length,
		touchedCount: creates.length,
		creates,
		exports: [],
		scripts: [],
	};

	return { evidence: evidenceIndex(), facts: evidenceFacts(), declaration };
};

describe('draftFocusedPhasedPlan', () => {
	test('composes the engine-owned sections before the closing lint', async () => {
		// The writer leaves two defects a record settles: a phase file with no
		// '## Global Constraints' at all, and a declaration heading numbered
		// against its own table row.
		const draft = setupFocusedPhasedDraft({
			name: 'composed',
			respond: ({ role, path }) => {
				if (role === 'overview') {
					return overviewBody({ rows: [phaseRow({ created: 9, touched: 9 })] }).replace('### Phase 1 —', '### Phase 3 —');
				}

				return role === 'phase' ? phaseWithoutConstraints() : unchangedFixReport({ path });
			},
		});

		const result = await draftFocusedPhasedPlan({ context: draft.context, step: 'draft' });

		expectStatus(result, 'complete');

		const overview = readFileSync(join(draft.planDir, 'overview.md'), 'utf8');
		const phase = readFileSync(join(draft.planDir, 'phase1-core.md'), 'utf8');

		// A repair spawn would mean the lint saw what the writer left rather than
		// what the engine composed — the counts stamped, the row and the heading
		// rendered from one record, and the settled rule in every file.
		expect({
			repairs: draft.calls.filter(({ role }) => role === 'repair').length,
			row: overview.includes('| 1 | `phase1-core.md` | the work | 1 | 1 |'),
			heading: overview.includes('### Phase 1 — `phase1-core.md`'),
			strayHeading: overview.includes('### Phase 3'),
			overviewConstraint: overview.includes(`- ${constraintChoice}`),
			phaseConstraint: phase.includes('## Global Constraints') && phase.includes(`- ${constraintChoice}`),
		}).toStrictEqual({ repairs: 0, row: true, heading: true, strayHeading: false, overviewConstraint: true, phaseConstraint: true });
	});

	test('gives the repair agent only the findings the engine could not fix', async () => {
		// Two defects in one round: the declared file budget disagreeing with the
		// phase file's own (a record settles it) and a placeholder (nothing does).
		const draft = setupFocusedPhasedDraft({
			name: 'mechanical',
			respond: ({ role, path }) => {
				if (role === 'overview') {
					return overviewBody({ rows: [phaseRow({ fileBudget: 9 })] });
				}

				if (role === 'phase') {
					return phaseWithBudget({ placeholder: true });
				}

				if (role === 'repair') {
					// The repairer resolves the placeholder it was handed and nothing
					// else. It writes the phase file itself: the repair brief lists the
					// overview first, so a body returned here would land on the wrong
					// file.
					writeFileSync(join(dirname(path), 'phase1-core.md'), phaseWithBudget());

					return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
				}

				return unchangedFixReport({ path });
			},
		});

		const result = await draftFocusedPhasedPlan({ context: draft.context, step: 'draft' });

		expectStatus(result, 'complete');

		const overview = readFileSync(join(draft.planDir, 'overview.md'), 'utf8');
		const repairPrompts = draft.calls.filter(({ role }) => role === 'repair').map(({ prompt }) => prompt);

		expect({
			repairs: repairPrompts.length,
			judgmentFinding: repairPrompts[0]?.includes('[no-placeholders]'),
			mechanicalFinding: repairPrompts[0]?.includes('declaration-consistent'),
			budget: overview.includes('- **File budget:** 12'),
			staleBudget: overview.includes('- **File budget:** 9'),
		}).toStrictEqual({ repairs: 1, judgmentFinding: true, mechanicalFinding: false, budget: true, staleBudget: false });
	});

	test("narrows a phase's evidence to the areas its declared paths reach", () => {
		const narrowing = setupPhaseEvidence({ creates: ['packages/alpha/src/three.ts'] });

		const selected = selectPhaseEvidence(narrowing);

		// the area the phase's own paths reach, plus every reference pattern —
		// what the writer is being asked to imitate is not something its own paths
		// point at
		expect(selected.entries.map(({ path }) => path).sort()).toStrictEqual(['packages/alpha/src/one.ts', 'packages/beta/src/mirror.ts']);
	});

	test('hands a declaration with no creates the whole evidence index', () => {
		const narrowing = setupPhaseEvidence({ creates: [] });

		const selected = selectPhaseEvidence(narrowing);

		// no signal to narrow by is the honest degradation: the writer gets
		// everything the engine read rather than a guess at what it needs
		expect(selected).toStrictEqual(narrowing.evidence);
	});
});
