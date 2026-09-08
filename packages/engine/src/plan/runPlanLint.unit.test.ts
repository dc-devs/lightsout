import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DecisionSource, type DecisionsRecord, FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { renderDecisionLog } from '#src/plan/decisionLog/index.ts';
import { runPlanLint } from '#src/plan/runPlanLint.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** Write a plan deliverable at `.lightsout/plans/<name>/plan.md`. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), body);
};

/**
 * Write the decision record the pass reads the plan's Decision Log against.
 * Separate from `writePlan` on purpose: one case below deletes nothing and
 * simply never writes it, which is how a missing record is tested.
 */
const writeDecisions = ({ cwd, name, record }: { cwd: string; name: string; record?: DecisionsRecord }) => {
	writeFileSync(join(cwd, '.lightsout', 'plans', name, 'decisions.json'), JSON.stringify(record ?? { planName: name, decisions: [] }));
};

/**
 * A structurally clean single plan whose paths resolve against setupConsumerRepo.
 * `createPath` is per-file: two phases creating one path is a real cross-phase
 * defect, so the shared body's create path is swapped for the given one.
 * `reference` gives the file the Decision Log pointer a phase of a phased
 * deliverable carries instead of the table.
 */
const cleanPlan = ({ createPath = 'src/new-thing.ts', reference = false }: { createPath?: string; reference?: boolean } = {}) =>
	cleanPlanBody({ reference }).replace('src/new-thing.ts', createPath);

test('plan lint: a clean plan returns complete with no findings and names the plan file', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'clean', body: cleanPlan() });
	writeDecisions({ cwd, name: 'clean' });

	const result = await runPlanLint({ cwd, name: 'clean' });

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// clean plan should have no findings, got: ${JSON.stringify(result.findings)}
	expect(result.findings).toStrictEqual([]);
	// the resolved deliverable path comes back
	expect(result.planPaths).toStrictEqual([join(cwd, '.lightsout', 'plans', 'clean', 'plan.md')]);
});

test('plan lint: a planted TBD comes back as a NoPlaceholders finding', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'dirty', body: cleanPlan().replace('A new module exporting', 'TBD — a new module exporting') });
	writeDecisions({ cwd, name: 'dirty' });

	const result = await runPlanLint({ cwd, name: 'dirty' });

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// the TBD is flagged, got: ${JSON.stringify(result.findings)}
	expect(result.findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders)).toBeTruthy();
});

test('plan lint: the progress line reports the finding count and how many files were scanned', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'progress', body: cleanPlan().replace('A new module exporting', 'TBD — a new module exporting') });
	writeDecisions({ cwd, name: 'progress' });
	const messages: string[] = [];

	const result = await runPlanLint({ cwd, name: 'progress', onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	// one progress line per lint pass, and it separates what gates from what only
	// informs
	expect(messages.length).toBe(1);
	expect(messages[0]).toMatch(/progress.*1 blocking, 0 advisory finding\(s\).*1 file\(s\)/);
});

test('plan lint: the progress line counts advisories apart from what gates, and both come back', async () => {
	const cwd = setupConsumerRepo();

	plantAdvisoryTouchedFiles({ cwd });
	writePlan({ cwd, name: 'noted', body: advisoryPlanBody() });
	writeDecisions({ cwd, name: 'noted' });

	const messages: string[] = [];
	const result = await runPlanLint({ cwd, name: 'noted', onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	// nothing gates, so the exit code stays clean while the note still prints
	expect(messages[0]).toMatch(/noted: 0 blocking, 1 advisory finding\(s\)/);
	expect(result.findings.map(({ check, severity }) => ({ check, severity }))).toStrictEqual([
		{ check: StructuralCheck.ScopeWithinGuardrail, severity: FindingSeverity.Advisory },
	]);
});

test('plan lint: no deliverable on disk returns failed', async () => {
	const cwd = setupConsumerRepo();

	const result = await runPlanLint({ cwd, name: 'ghost' });

	expectStatus(result, 'failed');
	// the resolve error propagates
	expect('error' in result && /no plan found for 'ghost'/.test(result.error)).toBeTruthy();
	// and names both shapes it looked for, got: ${'error' in result ? result.error : ''}
	expect('error' in result && result.error.includes(join(cwd, '.lightsout', 'plans', 'ghost', 'plan.md'))).toBeTruthy();
	expect('error' in result && result.error.includes(join(cwd, '.lightsout', 'plans', 'ghost')) && result.error.includes('phase<N>-<slug>.md')).toBeTruthy();
});

/** A structurally clean overview file — the overview variant's own required section set. Its phase rows must name exactly the phase files written beside it, or the declaration is inconsistent with the deliverable. */
const cleanOverview = ({ phaseCount = 2 }: { phaseCount?: number } = {}) => `# Phased Plan — Overview

${renderDecisionLog({ decisions: [] })}

## Global Constraints

- None

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | \`phase1-core.md\` | the core | 1 | 1 |${phaseCount > 1 ? '\n| 2 | `phase2-extra.md` | the rest | 1 | 1 |' : ''}

## Phase Declarations

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none
${phaseCount > 1 ? '\n### Phase 2 — `phase2-extra.md`\n\n- **Creates:** none\n- **Exports:** none\n- **Scripts:** none\n' : ''}
## Cross-Phase Dependencies

- Phase 2 follows phase 1.
`;

/** Write a phased deliverable into `.lightsout/plans/<name>/` and return that folder. */
const writePhasedPlan = ({ cwd, name, files }: { cwd: string; name: string; files: Record<string, string> }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });

	for (const [fileName, body] of Object.entries(files)) {
		writeFileSync(join(dir, fileName), body);
	}

	writeDecisions({ cwd, name });

	return dir;
};

test('plan lint: a phased deliverable lints the overview first, then each phase, ignoring non-markdown', async () => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlan({
		cwd,
		name: 'phased',
		files: {
			'overview.md': cleanOverview(),
			'phase1-core.md': cleanPlan({ createPath: 'src/core.ts', reference: true }),
			'phase2-extra.md': cleanPlan({ createPath: 'src/extra.ts', reference: true }),
			'notes.txt': 'scratch notes, not a plan',
		},
	});

	const result = await runPlanLint({ cwd, name: 'phased' });

	expectStatus(result, 'complete');
	expect('planPaths' in result).toBeTruthy();
	// the overview fronts the sorted phase files and notes.txt is not a plan
	expect(result.planPaths).toStrictEqual([join(dir, 'overview.md'), join(dir, 'phase1-core.md'), join(dir, 'phase2-extra.md')]);
	// a clean phased deliverable has no findings, got:
	// ${JSON.stringify(result.findings)}
	expect(result.findings).toStrictEqual([]);
});

/** A scratch working file that would be flagged all over if it were ever linted as a plan. */
const scratchNotes = () => `# Scratch

TBD — decide the shape later.
`;

test('plan lint: a stray markdown file in the plan folder is not linted as a phase', async () => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlan({
		cwd,
		name: 'strays',
		files: {
			'overview.md': cleanOverview({ phaseCount: 1 }),
			'phase1-core.md': cleanPlan({ reference: true }),
			'brainstorm-notes.md': scratchNotes(),
			'phases.md': scratchNotes(),
		},
	});

	const result = await runPlanLint({ cwd, name: 'strays' });

	expectStatus(result, 'complete');
	expect('planPaths' in result).toBeTruthy();
	// only files named overview.md or phase<N>-… are plans; the plan's working
	// files share the folder
	expect(result.planPaths).toStrictEqual([join(dir, 'overview.md'), join(dir, 'phase1-core.md')]);
	// the scratch files never reached the lint, got: ${JSON.stringify(result.findings)}
	expect(result.findings).toStrictEqual([]);
});

test('plan lint: a folder holding only working files reports no plan found', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'workspace-only',
		files: { 'brainstorm-notes.md': scratchNotes(), 'grade.json': '{}' },
	});

	const result = await runPlanLint({ cwd, name: 'workspace-only' });

	expectStatus(result, 'failed');
	// a readable folder with nothing plan-named is still no deliverable
	expect('error' in result && /no plan found for 'workspace-only'/.test(result.error)).toBeTruthy();
});

test('plan lint: plan.md is the sole deliverable even when the folder also holds phase files', async () => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlan({
		cwd,
		name: 'both',
		files: {
			'plan.md': cleanPlan(),
			'overview.md': cleanOverview(),
			'phase1-core.md': cleanPlan(),
		},
	});

	const result = await runPlanLint({ cwd, name: 'both' });

	expectStatus(result, 'complete');
	expect('planPaths' in result).toBeTruthy();
	// a single plan short-circuits the folder scan — no overview, no phases
	expect(result.planPaths).toStrictEqual([join(dir, 'plan.md')]);
});

test('plan lint: the target repo config reaches the structural lint', async () => {
	const cwd = setupConsumerRepo({ config: { 'packages-dir': 'modules' } });
	writePlan({ cwd, name: 'configured', body: cleanPlan().replace('### `src/index.js`', '### `modules/loose.ts`') });
	writeDecisions({ cwd, name: 'configured' });

	const result = await runPlanLint({ cwd, name: 'configured' });

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// the configured packagesDir drove the check, got:
	// ${JSON.stringify(result.findings)}
	expect(
		result.findings.some((finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes('directly under modules/')),
	).toBeTruthy();
});

test('plan lint: an unreadable config refuses instead of linting against defaults nobody chose', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'no-config', body: cleanPlan() });
	writeDecisions({ cwd, name: 'no-config' });

	writeFileSync(join(cwd, 'lightsout.config.json'), '{ not json');

	// The test above this one shows `packages-dir` deciding what the lint
	// reports. A config that will not parse therefore changes the findings
	// silently, which is the failure that cost a bisect to find on
	// standards-check. A repo with NO config still lints at the defaults.
	await expect(runPlanLint({ cwd, name: 'no-config' })).rejects.toThrow(/is not valid JSON/);
});

/** The saved record a plan's Decision Log must agree with — one row, so a single cell can be changed to make a section stale. */
const decisionsRecord = ({ planName }: { planName: string }): DecisionsRecord => ({
	planName,
	decisions: [
		{
			source: DecisionSource.Elicitation,
			question: 'Where does the decision-log module live?',
			options: 'at the top of plan / in a folder of its own',
			choice: 'in a folder of its own',
			rationale: 'the top of plan is at its file cap',
			assumption: false,
		},
	],
});

/** Write a single plan carrying `section` as its Decision Log, beside the `decisions.json` the pass reads that section against. */
const writeRecordedPlan = ({ cwd, name, section, record }: { cwd: string; name: string; section: string; record: DecisionsRecord }) => {
	writePlan({ cwd, name, body: cleanPlan().replace('## Global Constraints', `${section}\n\n## Global Constraints`) });
	writeDecisions({ cwd, name, record });
};

test('runPlanLint: a stale Decision Log is a blocking finding and a current one is not', async () => {
	const cwd = setupConsumerRepo();
	const record = decisionsRecord({ planName: 'recorded' });
	// Rendered rather than hand-written: the fixture is current by construction,
	// so the stale half below differs by exactly the one cell it edits.
	const section = renderDecisionLog({ decisions: record.decisions });

	writeRecordedPlan({ cwd, name: 'recorded', section, record });
	writeRecordedPlan({
		cwd,
		name: 'hand-edited',
		section: section.replace('the top of plan is at its file cap', 'because it reads better that way'),
		record: { ...record, planName: 'hand-edited' },
	});

	const current = await runPlanLint({ cwd, name: 'recorded' });
	const stale = await runPlanLint({ cwd, name: 'hand-edited' });

	expectStatus(current, 'complete');
	expectStatus(stale, 'complete');
	// the plan carrying the section the record renders has nothing to fix, got:
	// ${JSON.stringify(current.findings)}
	expect(current.findings.filter((finding) => finding.check === StructuralCheck.DecisionLogCurrent)).toStrictEqual([]);
	// one edited rationale blocks, against the plan file that carries it, got:
	// ${JSON.stringify(stale.findings)}
	expect(
		stale.findings.filter((finding) => finding.check === StructuralCheck.DecisionLogCurrent).map(({ severity, phase }) => ({ severity, phase })),
	).toStrictEqual([{ severity: FindingSeverity.Blocking, phase: 'plan.md' }]);
});

test('runPlanLint: a missing decisions.json fails the pass with a message naming the file', async () => {
	const cwd = setupConsumerRepo();

	writePlan({ cwd, name: 'unrecorded', body: cleanPlan() });

	const result = await runPlanLint({ cwd, name: 'unrecorded' });

	// A check whose record can be deleted is a check that can be switched off, so
	// the absent record refuses the pass instead of skipping the comparison.
	expectStatus(result, 'failed');
	// and names the file and where it was looked for, got:
	// ${'error' in result ? result.error : ''}
	expect('error' in result && result.error.includes(join(cwd, '.lightsout', 'plans', 'unrecorded', 'decisions.json'))).toBeTruthy();
});
