import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { PlanDraftStatus, PlanFixStatus, PlanVariant } from '@/contracts';
import type { Driver } from '@/drivers';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { planDraftCommand } from '@/cli/plan/planDraftCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { cleanPlanBody } from '@tests/helpers/cleanPlanBody';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

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

		assert.ok(path, `plan path parsed from the writer prompt, got: ${prompt}`);

		if (body !== undefined) {
			writeFileSync(path, body);
		}

		return {
			text: JSON.stringify(report ?? { status: PlanDraftStatus.Drafted, filesWritten: [{ path, variant, scope: 'single' }], decisionsApplied: 0, assumptions: [], discrepancies: [] }),
			exitCode: 0,
		};
	},
});

// The plan workspace `plan draft` reads its authored facts and decisions from.
const setupDraft = ({ t, args = [] }: { t: TestContext; args?: string[] }) => {
	const captured = captureCommandOutput({ t });
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

	return { cwd, plansDir: join(cwd, '.claude', 'plans'), name: 'demo', flags: parseFlags({ args }), ...captured };
};

test('planDraftCommand: a structurally clean draft reports its variant, lists each written path, and exits 0', async (t) => {
	const { cwd, plansDir, name, flags, logged, errors, exitCodes } = setupDraft({ t });

	await assert.rejects(
		planDraftCommand({ cwd, driver: writerDriver({ body: cleanPlanBody() }), name, plansDir, standards: undefined, config: undefined, flags }),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.equal(printed[0], '\nplan draft demo — single, structurally clean');
	assert.equal(printed[1], `  ✓ ${join(plansDir, 'demo.md')}`);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('planDraftCommand: --scope phased drafts the overview variant and says so', async (t) => {
	const { cwd, plansDir, name, flags, logged, exitCodes } = setupDraft({ t, args: ['--scope', 'phased'] });

	await assert.rejects(
		planDraftCommand({
			cwd,
			driver: writerDriver({ body: overviewPlanBody(), variant: PlanVariant.Overview }),
			name,
			plansDir,
			standards: undefined,
			config: undefined,
			flags,
		}),
		/process\.exit/,
	);

	const printed = printedLines({ logged });

	assert.equal(printed[0], '\nplan draft demo — overview, structurally clean');
	assert.equal(printed[1], `  ✓ ${join(plansDir, 'demo', 'overview.md')}`);
	assert.deepEqual(exitCodes, [0]);
});

test('planDraftCommand: a facts/decisions discrepancy is reported as a facts error, one ⚠ per discrepancy, and exits 1', async (t) => {
	const { cwd, plansDir, name, flags, logged, errors, exitCodes } = setupDraft({ t });
	const report = { status: PlanDraftStatus.Error, filesWritten: [], decisionsApplied: 0, assumptions: [], discrepancies: ['src/gone.ts does not exist', 'the api package is named core'] };

	await assert.rejects(
		planDraftCommand({ cwd, driver: writerDriver({ report }), name, plansDir, standards: undefined, config: undefined, flags }),
		/process\.exit/,
	);

	assert.deepEqual(printedLines({ logged }), []);
	assert.match(errors[0] ?? '', /^\nfacts error — the plan-writer found the facts\/decisions do not match the codebase/);
	assert.equal(errors[1], '  ⚠ src/gone.ts does not exist');
	assert.equal(errors[2], '  ⚠ the api package is named core');
	assert.deepEqual(exitCodes, [1]);
});

test('planDraftCommand: a writer that reports a draft but writes no file fails with the run error and exits 1', async (t) => {
	const { cwd, plansDir, name, flags, errors, exitCodes } = setupDraft({ t });
	const report = { status: PlanDraftStatus.Drafted, filesWritten: [], decisionsApplied: 0, assumptions: [], discrepancies: [] };

	await assert.rejects(
		planDraftCommand({ cwd, driver: writerDriver({ report }), name, plansDir, standards: undefined, config: undefined, flags }),
		/process\.exit/,
	);

	assert.equal(errors[0], '\nplan-writer reported drafted but listed no files written');
	assert.deepEqual(exitCodes, [1]);
});

test('planDraftCommand: structural findings that survive the repair loop print with their fixes and exit 1', async (t) => {
	const { cwd, plansDir, name, flags, logged, errors, exitCodes } = setupDraft({ t });
	const dirtyBody = cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting');

	await assert.rejects(
		planDraftCommand({ cwd, driver: writerDriver({ body: dirtyBody }), name, plansDir, standards: undefined, config: undefined, flags }),
		/process\.exit/,
	);

	assert.deepEqual(printedLines({ logged }), []);
	assert.match(errors[0] ?? '', /^\n1 structural issue\(s\) remain after re-drafting — resolve, then re-draft:$/);
	assert.match(errors[1] ?? '', /^ {2}⚠ \[no-placeholders\] demo\.md:\d+ — unresolved placeholder 'TBD' present$/);
	assert.match(errors[2] ?? '', /^ {5}fix: resolve 'TBD'/);
	assert.deepEqual(exitCodes, [1]);
});
