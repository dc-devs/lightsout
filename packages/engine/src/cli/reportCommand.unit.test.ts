import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { reportCommand } from '#src/cli/reportCommand.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import { ProcessEndReason } from '#src/contracts/activity/ProcessEndReason.ts';
import { Effort } from '#src/contracts/Effort.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

/** The plan the record below belongs to — a ticket folder and one plan id inside it. */
const planAddress = 'lo-150-observability/001-report';

/**
 * One plan folder's activity record: a plan level holding one command run,
 * holding one step, holding one harness process that ran for sixty of the
 * command run's seventy seconds.
 *
 * Written to disk as the real file the reader opens rather than stubbed, the
 * bargain `frictionCommand.unit.test.ts` strikes — the command's whole job is
 * to turn what a run left behind into a printed answer, and a stub would prove
 * the printing without proving the reading.
 */
const planRecord: ActivityMark[] = [
	{ kind: ActivityMarkKind.LevelStart, id: 'plan-1', level: ActivityLevelKind.Plan, label: planAddress, at: '2026-09-17T09:00:00.000Z' },
	{
		kind: ActivityMarkKind.LevelStart,
		id: 'command-1',
		parentId: 'plan-1',
		level: ActivityLevelKind.CommandRun,
		label: 'plan draft',
		at: '2026-09-17T09:00:00.000Z',
	},
	{
		kind: ActivityMarkKind.LevelStart,
		id: 'step-1',
		parentId: 'command-1',
		level: ActivityLevelKind.Step,
		label: 'draft phase 1',
		at: '2026-09-17T09:00:05.000Z',
	},
	{
		kind: ActivityMarkKind.HarnessProcess,
		levelId: 'step-1',
		harness: 'claude-code',
		model: 'claude-opus-5',
		effort: Effort.High,
		spawn: 1,
		reemit: false,
		startedAt: '2026-09-17T09:00:05.000Z',
		endedAt: '2026-09-17T09:01:05.000Z',
		endReason: ProcessEndReason.Completed,
		usage: { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 250_000, costUsd: 4.5 },
	},
	{ kind: ActivityMarkKind.LevelEnd, id: 'step-1', at: '2026-09-17T09:01:05.000Z', outcome: RunStatus.Passed },
	{ kind: ActivityMarkKind.LevelEnd, id: 'command-1', at: '2026-09-17T09:01:10.000Z', outcome: RunStatus.Passed },
	{ kind: ActivityMarkKind.LevelEnd, id: 'plan-1', at: '2026-09-17T09:01:10.000Z', outcome: RunStatus.Passed },
];

/** A repository config whose price list names the model the record ran under. */
const pricingConfig = {
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	pricing: { 'claude-opus-5': { input: 15, output: 75, 'cache-read': 1.5, 'cache-write': 18.75 } },
};

const setupReport = ({ args, config }: { args: string[]; config?: Record<string, unknown> }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-report-command-'));
	const planDir = join(cwd, '.lightsout', 'work-orders', 'lo-150-observability', 'plans', '001-report');

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	mkdirSync(planDir, { recursive: true });
	writeFileSync(join(planDir, 'activity.jsonl'), `${planRecord.map((mark) => JSON.stringify(mark)).join('\n')}\n`);

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

test("reportCommand: --plan prints the plan's tree and exits 0", async () => {
	const { context, logged, errors, exitCodes } = setupReport({ args: ['--plan', planAddress] });

	await expect(reportCommand(context)).rejects.toThrow(/process\.exit/);

	const printed = logged.join('\n');

	expect(exitCodes).toStrictEqual([0]);
	expect(errors).toStrictEqual([]);
	// the plan it was asked for, and the levels beneath it down to the step the
	// one harness process ran inside
	expect(printed).toContain(planAddress);
	expect(printed).toContain('plan draft');
	expect(printed).toContain('draft phase 1');
	// seventy seconds of wall time beside sixty of agent time, and the cost the
	// harness itself stated
	expect(printed).toContain('1m 10s');
	expect(printed).toContain('1m 00s');
	expect(printed).toContain('$4.50');
	expect(logged.some((line) => line.startsWith('│'))).toBe(true);
});

test('reportCommand: --json prints the same totals as data and no table', async () => {
	const { context, logged, errors, exitCodes } = setupReport({ args: ['--plan', planAddress, '--json'] });

	await expect(reportCommand(context)).rejects.toThrow(/process\.exit/);

	const payload = JSON.parse(logged.join('\n')) as {
		target: string;
		workOrderFolder: boolean;
		plans: { name: string; report: { totals: unknown } }[];
	};

	expect(exitCodes).toStrictEqual([0]);
	expect(errors).toStrictEqual([]);
	expect(payload).toEqual(expect.objectContaining({ target: planAddress, workOrderFolder: false }));
	expect(payload.plans).toHaveLength(1);
	expect(payload.plans[0]).toEqual(expect.objectContaining({ name: planAddress }));
	// the same figures the table prints: seventy seconds of wall time, sixty of
	// agent time, ten with no agent running at all, and every token the one
	// process reported
	expect(payload.plans[0]?.report.totals).toStrictEqual({
		wallMs: 70_000,
		agentMs: 60_000,
		busyMs: 60_000,
		idleMs: 10_000,
		peakProcesses: 1,
		processCount: 1,
		usage: { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 250_000, costUsd: 4.5 },
	});
	// a data run prints data and nothing else — a box-drawn row here would mean
	// a second surface was reading a second calculation
	expect(logged.some((line) => line.startsWith('│'))).toBe(false);
});

test('reportCommand: --json carries the configured estimate per plan, and none when no rates are configured', async () => {
	const priced = setupReport({ args: ['--plan', planAddress, '--json'], config: pricingConfig });

	await expect(reportCommand(priced.context)).rejects.toThrow(/process\.exit/);

	const unpriced = setupReport({ args: ['--plan', planAddress, '--json'] });

	await expect(reportCommand(unpriced.context)).rejects.toThrow(/process\.exit/);

	const pricedPayload = JSON.parse(priced.logged.join('\n')) as { plans: { estimatedCostUsd?: number }[] };
	const unpricedPayload = JSON.parse(unpriced.logged.join('\n')) as { plans: { estimatedCostUsd?: number }[] };

	// a million input tokens at $15, half a million output at $75, two million
	// cache reads at $1.50 and a quarter million cache writes at $18.75
	expect(pricedPayload.plans[0]?.estimatedCostUsd).toBe(60.1875);
	// a repository that configured no rates carries no estimate at all — a zero
	// there would read as an agent that cost nothing
	expect(unpricedPayload.plans[0]).not.toHaveProperty('estimatedCostUsd');
	expect([priced.exitCodes, unpriced.exitCodes]).toStrictEqual([[0], [0]]);
});

test('reportCommand: a missing --plan prints the usage text and exits 1', async () => {
	const { context, logged, errors, exitCodes } = setupReport({ args: [] });

	await expect(reportCommand(context)).rejects.toThrow(/process\.exit/);

	// no plan is named, so there is no plan to default to — a report of some
	// other plan would answer a question nobody asked
	expect(logged).toStrictEqual([]);
	expect(errors).toStrictEqual([usageFixture]);
	expect(exitCodes).toStrictEqual([1]);
});

test('reportCommand: an unknown plan name prints the error and exits 1', async () => {
	const { context, cwd, logged, errors, exitCodes } = setupReport({ args: ['--plan', 'lo-999-missing/001-nothing'] });

	await expect(reportCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors).toHaveLength(1);
	// the name that was asked for and the directory that answered, so a reader
	// can see which checkout was searched
	expect(errors[0]).toContain('lo-999-missing/001-nothing');
	expect(errors[0]).toContain(join(cwd, '.lightsout', 'work-orders'));
	expect(exitCodes).toStrictEqual([1]);
});

test('reportCommand: a configured price list adds the estimate column, and a repository with no config still reports without it', async () => {
	const priced = setupReport({ args: ['--plan', planAddress], config: pricingConfig });

	await expect(reportCommand(priced.context)).rejects.toThrow(/process\.exit/);

	// a second repository, identical but for the missing config file; each setup
	// re-points the console and exit spies at fresh arrays
	const unpriced = setupReport({ args: ['--plan', planAddress] });

	await expect(reportCommand(unpriced.context)).rejects.toThrow(/process\.exit/);

	expect(priced.logged.join('\n')).toMatch(/estimat/i);
	// a repository that configured no rates loses that column and keeps every
	// other one — a report is never withheld for want of a price list
	expect(unpriced.logged.join('\n')).not.toMatch(/estimat/i);
	expect(unpriced.logged.join('\n')).toContain('draft phase 1');
	expect([priced.exitCodes, unpriced.exitCodes]).toStrictEqual([[0], [0]]);
});
