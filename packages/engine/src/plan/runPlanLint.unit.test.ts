import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { runPlanLint } from '#src/plan/runPlanLint.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** Write a plan deliverable at `.lightsout/plans/<name>/plan.md`. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), body);
};

/** A structurally clean single plan whose paths resolve against setupConsumerRepo. `createPath` is per-file: two phases creating one path is a real cross-phase defect. */
const cleanPlan = ({ createPath = 'src/new-thing.ts' }: { createPath?: string } = {}) => `# Clean Plan

## Context

A tiny clean plan for the structural lint.

## Global Constraints

- None

## Prerequisites

- None

## Files to Create

### \`${createPath}\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing/new-thing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None — standalone plan.
`;

test('plan lint: a clean plan returns complete with no findings and names the plan file', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'clean', body: cleanPlan() });

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

	const result = await runPlanLint({ cwd, name: 'dirty' });

	expectStatus(result, 'complete');
	expect('findings' in result).toBeTruthy();
	// the TBD is flagged, got: ${JSON.stringify(result.findings)}
	expect(result.findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders)).toBeTruthy();
});

test('plan lint: the progress line reports the finding count and how many files were scanned', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'progress', body: cleanPlan().replace('A new module exporting', 'TBD — a new module exporting') });
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

	return dir;
};

test('plan lint: a phased deliverable lints the overview first, then each phase, ignoring non-markdown', async () => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlan({
		cwd,
		name: 'phased',
		files: {
			'overview.md': cleanOverview(),
			'phase1-core.md': cleanPlan({ createPath: 'src/core.ts' }),
			'phase2-extra.md': cleanPlan({ createPath: 'src/extra.ts' }),
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
			'phase1-core.md': cleanPlan(),
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

	writeFileSync(join(cwd, 'lightsout.config.json'), '{ not json');

	// The test above this one shows `packages-dir` deciding what the lint
	// reports. A config that will not parse therefore changes the findings
	// silently, which is the failure that cost a bisect to find on
	// standards-check. A repo with NO config still lints at the defaults.
	await expect(runPlanLint({ cwd, name: 'no-config' })).rejects.toThrow(/is not valid JSON/);
});
