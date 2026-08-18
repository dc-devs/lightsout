import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { cleanPlanBody } from '@tests/helpers/cleanPlanBody';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { planDraftCommand } from '@/cli/plan';
import { PlanDraftStatus, PlanFixStatus, PlanVariant } from '@/contracts';
import type { Driver } from '@/drivers';

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** A minimal overview-variant plan: the three sections that variant requires, no create paths, no placeholders. */
const overviewPlanBody = () => `# Demo — Overview

## Phases

- Phase 1 — add the thing.

## Cross-Phase Dependencies

- None

## Global Constraints

- None
`;

/** The absolute path the writer prompt names — the writer's output line has the \`- <path>\` shape. */
const outputPathFrom = (prompt: string) => /- (\S+\.md)/.exec(prompt)?.[1];

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
			verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
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

	await expect(
		planDraftCommand({
			cwd,
			driver: writerDriver({ body: overviewPlanBody(), variant: PlanVariant.Overview }),
			name,
			standards: undefined,
			config: undefined,
			flags,
		}),
	).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0]).toBe('\nplan draft demo — overview, structurally clean');
	expect(printed[1]).toBe(`  ✓ ${join(planDir, 'overview.md')}`);
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
	expect(errors[1] ?? '').toMatch(/^ {2}⚠ \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present$/);
	expect(errors[2] ?? '').toMatch(/^ {5}fix: resolve 'TBD'/);
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
