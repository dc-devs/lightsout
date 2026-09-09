// The coordination half of runCoverageBatch: what the batch does when its gate
// run never got the machine. Its own file because the gates are stubbed here,
// while the other two halves run the consumer's real gate commands — a mocked
// gates module in either of those would take away the thing they prove. Its
// fixtures are its own, by the same rule that split the gates half out.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { runCoverageBatch } from '#src/coverage/batch/runCoverageBatch.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { report } from '#tests/helpers/report.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The gates are another module's entry point, with their own tests. They are
// stubbed here because a coordination reason is produced by a second run of the
// repository holding the machine for up to half an hour, which a batch test
// cannot stage on the machine it is running on.
const mockRunBatchGates = jest.fn<(params: { cwd: string; coverage: boolean; step: string }) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({
	runBatchGates: (params: { cwd: string; coverage: boolean; step: string }) => mockRunBatchGates(params),
}));
// -------------------------

const target = 'src/target.ts';
const summaryPath = 'coverage/coverage-summary.json';
const holderReason = 'gates never started: the machine is still taken by run r-77 in /repo/.worktrees/lo-42, held for 31m.';

/** One gate verdict, green unless the case says otherwise, with every channel spelled. */
const gateResultOf = (overrides: Partial<GateRunResult> = {}): GateRunResult => ({
	error: undefined,
	failedFamilies: [],
	crashes: [],
	coordination: undefined,
	...overrides,
});

/** An Istanbul summary naming the batch's file at the given percentage. */
const writeSummary = ({ dir, pct }: { dir: string; pct: number }) => {
	writeFileSync(join(dir, summaryPath), JSON.stringify({ total: { statements: { pct } }, [join(dir, target)]: { statements: { pct } } }));
};

/** A consumer repo whose coverage command is a no-op over a summary already on disk. */
const setupBatchRepo = () => {
	const dir = setupConsumerRepo({ scripts: { check: 'true', 'test-coverage': 'true' } });

	mkdirSync(join(dir, 'coverage'), { recursive: true });
	writeFileSync(join(dir, target), 'export const target = () => 1;\n');
	writeSummary({ dir, pct: 10 });
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	return dir;
};

const batch: CoverageBatch = {
	id: 'batch-01:root',
	scope: 'root',
	files: [{ path: target, scope: 'root', statementsPct: 10 }],
	members: [target],
};

const completed: DriverResult[] = [{ text: report({ changedFiles: [{ path: 'src/target.unit.test.ts', summary: 'covers target' }] }), exitCode: 0 }];

/**
 * A batch whose gates answer the given verdicts in order (the last repeating)
 * and whose writer always leaves a test file and a moved summary behind.
 *
 * The prompt list is what says how many invocations the batch spent, which is
 * the whole claim of these cases: a gate run that never started must buy no
 * agent.
 */
const setupCoordinationBatch = ({ gates, results = completed }: { gates: GateRunResult[]; results?: DriverResult[] }) => {
	const dir = setupBatchRepo();
	let gateCalls = 0;

	mockRunBatchGates.mockImplementation(async () => {
		const verdict = gates[Math.min(gateCalls, gates.length - 1)];

		gateCalls += 1;

		return verdict;
	});

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			prompts.push(prompt);
			writeFileSync(join(dir, 'src/target.unit.test.ts'), 'test("covers", () => undefined);\n');
			writeSummary({ dir, pct: 80 });

			return results[Math.min(prompts.length - 1, results.length - 1)];
		},
	};

	return {
		prompts,
		run: async () =>
			runCoverageBatch({
				cwd: dir,
				runId: 'run-1',
				driver,
				config: await readConfig({ cwd: dir }),
				batch,
				agentTimeoutMs: 60_000,
				attributedFiles: [],
				onProgress: () => undefined,
				recordUsage: async () => undefined,
			}),
	};
};

describe('runCoverageBatch coordination', () => {
	test('a gate run that never got the machine escalates the batch with that reason and buys no fix agent', async () => {
		const { run, prompts } = setupCoordinationBatch({ gates: [gateResultOf({ error: holderReason, coordination: holderReason })] });

		const outcome = await run();

		expect(outcome).toStrictEqual({ kind: 'escalated', error: holderReason });
		// the writer's own invocation and nothing else — no cheap fix was spent
		expect(prompts.length).toBe(1);
	});

	test('a re-run that never got the machine escalates on the reason, not on the red the fix was sent to repair', async () => {
		const { run, prompts } = setupCoordinationBatch({
			gates: [gateResultOf({ error: 'tsc: 1 error', failedFamilies: ['check'] }), gateResultOf({ error: holderReason, coordination: holderReason })],
		});

		const outcome = await run();

		expect(outcome).toStrictEqual({ kind: 'escalated', error: holderReason });
		// the writer and the one cheap fix the ordinary red had already bought
		expect(prompts.length).toBe(2);
	});

	test('an ordinary red still spends the cheap fixes and fails the batch with the gate output', async () => {
		const { run, prompts } = setupCoordinationBatch({ gates: [gateResultOf({ error: 'tsc: 1 error', failedFamilies: ['check'] })] });

		const outcome = await run();

		expect(outcome).toEqual({ kind: 'failed', error: expect.stringContaining('gates still red after 2 fix attempt(s)') });
		// the coordination guard swallows nothing: the whole cheap budget was spent
		expect(prompts.length).toBe(3);
	});

	test('a dead agent whose coverage moved is not salvaged when the gates never got the machine', async () => {
		const { run } = setupCoordinationBatch({
			gates: [gateResultOf({ error: holderReason, coordination: holderReason })],
			results: [{ text: 'I wrote the tests.', exitCode: 0 }],
		});

		const outcome = await run();

		// a gate run that never started proves nothing about the work on disk, so
		// the invocation failure stands
		expect(outcome).toEqual({ kind: 'failed', error: expect.stringContaining('did not match contract') });
	});
});
