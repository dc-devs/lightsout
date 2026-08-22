import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planDraftCommand } from '#src/cli/plan/index.ts';
import { PlanDraftStatus, PlanFixStatus, PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** A minimal overview-variant plan: the four sections that variant requires, one declared phase, no placeholders. */
const overviewPlanBody = () => `# Demo — Overview

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | \`phase1-core.md\` | add the thing | 1 | 1 |

## Phase Declarations

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

## Cross-Phase Dependencies

- None

## Global Constraints

- None
`;

/** The absolute path the writer prompt names — the writer's output line has the \`- <path>\` shape. */
const outputPathFrom = (prompt: string) => /- (\S+\.md)/.exec(prompt)?.[1];

/**
 * A two-stage phased writer stub: the overview spawn writes `overview.md`, and
 * the one phase spawn writes the phase file its own prompt names.
 */
const phasedWriterDriver = (): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		const path = outputPathFrom(prompt);

		// the engine dictates one output path per spawn
		expect(path).toBeTruthy();

		const phase = prompt.includes('## Phase authoring');

		if (path !== undefined) {
			writeFileSync(path, phase ? cleanPlanBody() : overviewPlanBody());
		}

		return {
			text: JSON.stringify({
				status: PlanDraftStatus.Drafted,
				filesWritten: [{ path, variant: phase ? PlanVariant.Phase : PlanVariant.Overview, scope: phase ? 'add the thing' : 'phased' }],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: [],
			}),
			exitCode: 0,
		};
	},
});

/**
 * A plan-writer stub: the draft invocation authors `body` at the path its prompt
 * names and returns a PlanDraftReport; a repair invocation declines, which ends
 * the repair loop after one round so a deliberately dirty draft resolves fast.
 * `report` overrides the drafted report to drive the non-drafted outcomes.
 */
const writerDriver = ({ body, variant = PlanVariant.Single, report }: { body?: string; variant?: PlanVariant; report?: unknown }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		if (prompt.includes('# Repair input')) {
			return { text: JSON.stringify({ status: PlanFixStatus.Error, filesEdited: [], discrepancies: ['cannot resolve from the findings'] }), exitCode: 0 };
		}

		const path = outputPathFrom(prompt);

		// plan path parsed from the writer prompt
		expect(path).toBeTruthy();

		if (body !== undefined && path !== undefined) {
			writeFileSync(path, body);
		}

		return {
			text: JSON.stringify(
				report ?? {
					status: PlanDraftStatus.Drafted,
					filesWritten: [{ path, variant, scope: 'single' }],
					decisionsApplied: 0,
					assumptions: [],
					discrepancies: [],
				},
			),
			exitCode: 0,
		};
	},
});

// The plan workspace `plan draft` reads its authored facts and decisions from.
const setupDraft = ({ args = [] }: { args?: string[] } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(
		join(workspaceDir, 'facts.json'),
		JSON.stringify({
			request: 'do a thing',
			areas: [],
			verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
			verifiedAt: '2026-01-01T00:00:00.000Z',
		}),
	);
	writeFileSync(join(workspaceDir, 'decisions.json'), JSON.stringify({ planName: 'demo', decisions: [] }));

	return { cwd, planDir: workspaceDir, name: 'demo', flags: parseFlags({ args }), ...captured };
};

test('planDraftCommand: a structurally clean draft reports its variant, lists each written path, and exits 0', async () => {
	const { cwd, planDir, name, flags, logged, errors, exitCodes } = setupDraft();

	await expect(
		planDraftCommand({ cwd, driver: writerDriver({ body: cleanPlanBody() }), name, standards: undefined, config: undefined, flags }),
	).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0]).toBe('\nplan draft demo — single, structurally clean');
	expect(printed[1]).toBe(`  ✓ ${join(planDir, 'plan.md')}`);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planDraftCommand: --scope phased drafts the overview variant and says so', async () => {
	const { cwd, planDir, name, flags, logged, exitCodes } = setupDraft({ args: ['--scope', 'phased'] });

	await expect(planDraftCommand({ cwd, driver: phasedWriterDriver(), name, standards: undefined, config: undefined, flags })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0]).toBe('\nplan draft demo — overview, structurally clean');
	// the overview and every phase file it declared, each verified on disk
	expect(printed[1]).toBe(`  ✓ ${join(planDir, 'overview.md')}`);
	expect(printed[2]).toBe(`  ✓ ${join(planDir, 'phase1-core.md')}`);
	expect(exitCodes).toStrictEqual([0]);
});

test('planDraftCommand: a facts/decisions discrepancy is reported as a facts error, one ⚠ per discrepancy, and exits 1', async () => {
	const { cwd, name, flags, logged, errors, exitCodes } = setupDraft();
	const report = {
		status: PlanDraftStatus.Error,
		filesWritten: [],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: ['src/gone.ts does not exist', 'the api package is named core'],
	};

	await expect(planDraftCommand({ cwd, driver: writerDriver({ report }), name, standards: undefined, config: undefined, flags })).rejects.toThrow(
		/process\.exit/,
	);

	expect(printedLines({ logged })).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/^\nfacts error — the plan-writer found the facts\/decisions do not match the codebase/);
	expect(errors[1]).toBe('  ⚠ src/gone.ts does not exist');
	expect(errors[2]).toBe('  ⚠ the api package is named core');
	expect(exitCodes).toStrictEqual([1]);
});

test('planDraftCommand: a writer that reports a draft but writes no file fails with the run error and exits 1', async () => {
	const { cwd, name, flags, errors, exitCodes } = setupDraft();
	const report = { status: PlanDraftStatus.Drafted, filesWritten: [], decisionsApplied: 0, assumptions: [], discrepancies: [] };

	await expect(planDraftCommand({ cwd, driver: writerDriver({ report }), name, standards: undefined, config: undefined, flags })).rejects.toThrow(
		/process\.exit/,
	);

	expect(errors[0]).toBe('\nplan-writer reported drafted but listed no files written');
	expect(exitCodes).toStrictEqual([1]);
});

test('planDraftCommand: structural findings that survive the repair loop print with their fixes and exit 1', async () => {
	const { cwd, name, flags, logged, errors, exitCodes } = setupDraft();
	const dirtyBody = cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting');

	await expect(planDraftCommand({ cwd, driver: writerDriver({ body: dirtyBody }), name, standards: undefined, config: undefined, flags })).rejects.toThrow(
		/process\.exit/,
	);

	expect(printedLines({ logged })).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/^\n1 structural issue\(s\) remain after re-drafting — resolve, then re-draft:$/);
	expect(errors[1] ?? '').toMatch(/^⚠ plan\.md \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present$/);
	expect(errors[2] ?? '').toMatch(/^ {3}fix: resolve 'TBD'/);
	expect(exitCodes).toStrictEqual([1]);
});

test('planDraftCommand: --scope single forces the one-file variant instead of leaving it to the estimate', async () => {
	const { cwd, planDir, name, flags, logged, exitCodes } = setupDraft({ args: ['--scope', 'single'] });

	await expect(
		planDraftCommand({
			cwd,
			driver: writerDriver({ body: cleanPlanBody() }),
			name,
			standards: undefined,
			config: undefined,
			flags,
		}),
	).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	// the flag decides, so the plan's folder holds one plan.md rather than an
	// overview and its phases
	expect(printed[0]).toBe('\nplan draft demo — single, structurally clean');
	expect(printed[1]).toBe(`  ✓ ${join(planDir, 'plan.md')}`);
	expect(exitCodes).toStrictEqual([0]);
});

/**
 * A clean plan grown past the touched-file limit by 55 earlier-phase modifies —
 * paths a predecessor writes, so absent from disk and never a path-exists
 * defect. One create plus those 55 is 56 touched source files, well under the
 * 30-file created ceiling, so the only finding is the advisory note.
 */
const mechanicalPlanBody = () => {
	const entries = Array.from({ length: 55 }, (_, index) => `### \`src/renamed${index}.ts\`\n\nRename one import.\n`).join('\n');

	return `${cleanPlanBody()}\n## Files to Modify from Earlier Phases\n\n${entries}\n`;
};

test('planDraftCommand: an advisory rides a clean draft to stdout, beneath the written paths, and still exits 0', async () => {
	const { cwd, planDir, name, flags, logged, errors, exitCodes } = setupDraft();

	await expect(
		planDraftCommand({ cwd, driver: writerDriver({ body: mechanicalPlanBody() }), name, standards: undefined, config: undefined, flags }),
	).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0]).toBe('\nplan draft demo — single, structurally clean');
	expect(printed[1]).toBe(`  ✓ ${join(planDir, 'plan.md')}`);
	// computed, persisted and never seen is the failure this branch exists to
	// prevent — an advisory gates nothing, so a clean draft is where it gets read
	expect(printed[2] ?? '').toMatch(/^note plan\.md \[scope-within-guardrail\] plan\.md — plan touches 56 source files, over the 50-file limit/);
	expect(printed[3] ?? '').toMatch(/^ {3}fix: legal, but the implementing agent stops at 50 files/);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planDraftCommand: a hand-back counts and lists only the blocking findings, and still prints the advisory riding with them', async () => {
	const { cwd, name, flags, logged, errors, exitCodes } = setupDraft();
	const dirtyMechanicalBody = mechanicalPlanBody().replace('A new module exporting', 'TBD — a new module exporting');

	await expect(
		planDraftCommand({ cwd, driver: writerDriver({ body: dirtyMechanicalBody }), name, standards: undefined, config: undefined, flags }),
	).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	// two findings survive, one of them advisory: the count and the ⚠ list carry
	// only the one that gates, so a note can never read as a reason to re-draft
	expect(errors[0] ?? '').toMatch(/^\n1 structural issue\(s\) remain after re-drafting — resolve, then re-draft:$/);
	expect(errors[1] ?? '').toMatch(/^⚠ plan\.md \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present$/);
	expect(errors).toHaveLength(3);
	expect(printed[0] ?? '').toMatch(/^note plan\.md \[scope-within-guardrail\] plan\.md — plan touches 56 source files, over the 50-file limit/);
	expect(exitCodes).toStrictEqual([1]);
});

/**
 * A phased writer stub whose overview declares nine phases — one over the soft
 * threshold, so the breakdown check notes what grading them will cost — and
 * whose every phase spawn reports a facts discrepancy rather than authoring a
 * file.
 */
const phasedFactsErrorDriver = ({ phases }: { phases: number }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		if (prompt.includes('## Phase authoring')) {
			return {
				text: JSON.stringify({
					status: PlanDraftStatus.Error,
					filesWritten: [],
					decisionsApplied: 0,
					assumptions: [],
					discrepancies: ['src/gone.ts does not exist'],
				}),
				exitCode: 0,
			};
		}

		const path = outputPathFrom(prompt);
		const rows = Array.from({ length: phases }, (_, index) => ({ number: index + 1, file: `phase${index + 1}-core.md`, created: 1, touched: 1 }));

		// the engine dictates the overview's path
		expect(path).toBeTruthy();

		if (path !== undefined) {
			writeFileSync(path, overviewBody({ rows }));
		}

		return {
			text: JSON.stringify({
				status: PlanDraftStatus.Drafted,
				filesWritten: [{ path, variant: PlanVariant.Overview, scope: 'phased' }],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: [],
			}),
			exitCode: 0,
		};
	},
});

test('planDraftCommand: a breakdown advisory still reaches the human when the phase fan-out ends the draft with a facts error', async () => {
	const { cwd, name, flags, logged, errors, exitCodes } = setupDraft({ args: ['--scope', 'phased'] });

	await expect(planDraftCommand({ cwd, driver: phasedFactsErrorDriver({ phases: 9 }), name, standards: undefined, config: undefined, flags })).rejects.toThrow(
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	expect(errors[0] ?? '').toMatch(/^\nfacts error — the plan-writer found the facts\/decisions do not match the codebase/);
	// one ⚠ per phase spawn, each labelled with the phase file that raised it
	expect(errors[1]).toBe('  ⚠ phase1-core.md: src/gone.ts does not exist');
	expect(errors).toHaveLength(10);
	// the over-eight-phases note is the human's only notice of what reviewing
	// this plan costs, so it survives the draft ending in an error
	expect(printed[0] ?? '').toMatch(/^note overview\.md \[phase-count\] .+ 9 phases, so one grading pass runs 27 gap-check agents/);
	expect(exitCodes).toStrictEqual([1]);
});
