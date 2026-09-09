import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@jest/globals';
import { type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import { runWriterBatches } from '#src/pipeline/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

// How the fan-out schedules: which groups may run beside each other, how a
// freed slot refills, what every writer is briefed with, and how the reports
// come back. The warm-up writer's own gate is a concern of its own, in one suite
// beside this one; rate limits and writer failures are in another.

// The fan-out's scenarios are split by concern, and each suite arranges its own
// writers. The stub below is restated per suite deliberately: a fixture reached
// across module lines would have to import this module's internals from outside
// it, and the barrel is not the place to publish a type only a test names.

/** A complete WorkReport with per-test overrides. */
const workReport = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'stub',
	failures: [],
	...overrides,
});

/** What a stubbed writer invocation returns — the invokeRole outcome runWriterBatches reads. */
type Outcome = { ok: true; report: WorkReport } | { ok: false; failure: string; rateLimited: boolean };

/** A writer that answered with a report. */
const answered = (report: WorkReport): Outcome => ({ ok: true, report });

/**
 * A PipelineRun stub that records an ordered event log: `start:<file>` when a
 * writer spawns, `event:<file>` when it streams its first event, `end:<file>`
 * when it resolves. `respond` decides each writer's behavior by target file.
 */
const setupWriterRun = ({ respond }: { respond: (params: { file: string; onFirstEvent?: () => void; log: string[] }) => Promise<Outcome> }) => {
	const log: string[] = [];
	const prompts: string[] = [];

	const run = {
		cwd: mkdtempSync(join(tmpdir(), 'lightsout-writers-')),
		current: () => ({ runId: 'run-1' }),
		progress: () => undefined,
		invokeRole: async ({ invocation, onFirstEvent }: { invocation: { prompt: string }; onFirstEvent?: () => void }) => {
			const file = /- (\S+)/.exec(invocation.prompt)?.[1] ?? 'unknown';

			prompts.push(invocation.prompt);
			log.push(`start:${file}`);

			const outcome = await respond({ file, onFirstEvent, log });

			log.push(`end:${file}`);

			return outcome;
		},
	};

	return { run: run as unknown as PipelineRun, log, prompts };
};

/** One group per distinct subject file, so no group ever blocks another and every one competes for a slot. */
const groupsOf = (count: number): TestTargetGroup[] =>
	Array.from({ length: count }, (_, index) => ({
		subjects: [`src/file${index}.ts`],
		mustExecute: [`src/file${index}.ts`],
	}));

test('runWriterBatches: a freed slot takes the next group while a slow writer is still running', async () => {
	// One writer far slower than the rest. Under batching, nothing past the
	// first `testWriterConcurrency` groups could start until it returned; the
	// slots are meant to refill from the fast ones instead.
	const slow = 'src/file1.ts';
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
			}

			await delay(file === slow ? 200 : 5);

			return answered(workReport());
		},
	});

	const queued = 2;
	const overflow = `src/file${testWriterConcurrency + queued}.ts`;
	const { reports } = await runWriterBatches({ run, groups: groupsOf(testWriterConcurrency + queued + 1), planContent: '# Plan' });

	expect(reports.length).toBe(testWriterConcurrency + queued + 1);
	// the queued group ran on a slot freed by a fast writer, not after the slow one
	expect(log.indexOf(`start:${overflow}`)).toBeLessThan(log.indexOf(`end:${slow}`));
});

test('runWriterBatches: complete, failed, and absent reports aggregate exactly as the step expects', async () => {
	const { run } = setupWriterRun({
		respond: async ({ file }) => {
			if (file === 'src/file1.ts') {
				return answered(workReport({ status: WorkReportStatus.Failed, failures: ['bad assertion'] }));
			}

			if (file === 'src/file2.ts') {
				return { ok: false, failure: 'driver exploded', rateLimited: false };
			}

			if (file === 'src/file3.ts') {
				return answered(workReport({ status: WorkReportStatus.TerminatedAmbiguity, failures: ['unclear plan'] }));
			}

			return answered(workReport());
		},
	});

	const { reports, failures, terminated, parked } = await runWriterBatches({ run, groups: groupsOf(4), planContent: '# Plan' });

	expect(parked).toBe(false);
	// an absent report contributes no report
	expect(reports.length).toBe(3);
	expect(failures.includes('src/file1.ts: failed — bad assertion')).toBeTruthy();
	expect(failures.includes('src/file2.ts: driver exploded')).toBeTruthy();
	expect(failures.includes('src/file3.ts: terminated:ambiguity — unclear plan')).toBeTruthy();
	// a termination status escalates, a plain failure does not
	expect(terminated).toBe(true);
});

test("runWriterBatches: the run's acceptance tests reach every writer in the fan-out", async () => {
	const { run, prompts } = setupWriterRun({ respond: async () => answered(workReport()) });
	const acceptanceTests = [
		{ criterion: 'the widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
	];

	await runWriterBatches({ run, groups: groupsOf(2), planContent: '# Plan', acceptanceTests });

	// every coverage writer is briefed with the bar, not just the first: any of
	// them could otherwise weaken a case the run has to prove
	expect(prompts.length).toBe(2);
	expect(prompts.every((prompt) => prompt.includes('- `widget: renders its label` in src/widget.unit.test.ts'))).toBeTruthy();
});

test('runWriterBatches: a run whose plan carries no ledger briefs its writers with no acceptance section', async () => {
	const { run, prompts } = setupWriterRun({ respond: async () => answered(workReport()) });

	await runWriterBatches({ run, groups: groupsOf(1), planContent: '# Plan' });

	// the section is omitted, not emitted empty
	expect(prompts[0]?.includes('# Acceptance tests')).toBeFalsy();
});

test('runWriterBatches: two groups sharing a subject never overlap while a group sharing none runs beside them', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent, log: events }) => {
			if (onFirstEvent) {
				events.push(`event:${file}`);
				onFirstEvent();
				await delay(40);
			}

			return answered(workReport());
		},
	});
	// Two assignments hold src/shared.ts between them, so no two writers may
	// ever hold it at once; the third shares nothing and must not wait.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/a1.ts', 'src/shared.ts'], mustExecute: ['src/a1.ts'] },
		{ subjects: ['src/a2.ts', 'src/shared.ts'], mustExecute: ['src/a2.ts'] },
		{ subjects: ['src/b.ts'], mustExecute: ['src/b.ts'] },
	];

	const { reports, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(reports.length).toBe(3);
	// the subject is never held by two writers at once
	expect(log.indexOf('end:src/a1.ts')).toBeLessThan(log.indexOf('start:src/a2.ts'));
	// the group sharing no subject starts while the first one is still running
	expect(log.indexOf('start:src/b.ts')).toBeLessThan(log.indexOf('end:src/a1.ts'));
});

test('runWriterBatches: chunks of one component with disjoint subjects run at the same time', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
				await delay(40);
			}

			return answered(workReport());
		},
	});
	// The oversized-component case: one component split into two chunks, whose
	// subject lists share nothing. Nothing excludes them from each other.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/chunk1.ts'], mustExecute: ['src/big/one.ts', 'src/big/two.ts'] },
		{ subjects: ['src/chunk2.ts'], mustExecute: ['src/big/one.ts', 'src/big/two.ts'] },
	];

	const { reports, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(reports.length).toBe(2);
	// the second chunk is in flight before the first settles
	expect(log.indexOf('start:src/chunk2.ts')).toBeLessThan(log.indexOf('end:src/chunk1.ts'));
});

test('runWriterBatches: a blocked group is passed over so a later independent group takes the free slot', async () => {
	const slow = 'src/holder.ts';
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
			}

			await delay(file === slow ? 60 : 1);

			return answered(workReport());
		},
	});
	// Four groups, ten slots: the blocked group is queued ahead of the
	// independent one, so a scheduler that stalls on it wastes a free slot.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/warm.ts'], mustExecute: ['src/warm.ts'] },
		{ subjects: ['src/holder.ts', 'src/shared.ts'], mustExecute: ['src/holder.ts'] },
		{ subjects: ['src/blocked.ts', 'src/shared.ts'], mustExecute: ['src/blocked.ts'] },
		{ subjects: ['src/independent.ts'], mustExecute: ['src/independent.ts'] },
	];

	const { reports, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(reports.length).toBe(4);
	// the independent group takes the slot the blocked one could not use
	expect(log.indexOf('start:src/independent.ts')).toBeLessThan(log.indexOf(`end:${slow}`));
	// and the blocked group still waits for the subject it needs
	expect(log.indexOf('start:src/blocked.ts')).toBeGreaterThan(log.indexOf(`end:${slow}`));
});

test('runWriterBatches: a group blocked on a shared subject spawns once its blocker settles', async () => {
	const blocker = 'src/blocker.ts';
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
			}

			await delay(file === blocker ? 60 : 1);

			return answered(workReport());
		},
	});
	// The waiting group has no other route to a slot: only the blocker's
	// release can wake it.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/warm.ts'], mustExecute: ['src/warm.ts'] },
		{ subjects: ['src/blocker.ts', 'src/shared.ts'], mustExecute: ['src/blocker.ts'] },
		{ subjects: ['src/waiter.ts', 'src/shared.ts'], mustExecute: ['src/waiter.ts'] },
	];

	const { reports, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	expect(parked).toBe(false);
	// the released subject woke the waiting group, and it finished before the step returned
	expect(reports.length).toBe(3);
	expect(log.indexOf('end:src/blocker.ts')).toBeLessThan(log.indexOf('start:src/waiter.ts'));
	expect(log.includes('end:src/waiter.ts')).toBeTruthy();
});

test("runWriterBatches: a group sharing the warm-up writer's subjects waits for the warm spawn to settle", async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent, log: events }) => {
			if (onFirstEvent) {
				events.push(`event:${file}`);
				onFirstEvent();
				await delay(60);
			}

			return answered(workReport());
		},
	});
	// The warm writer streams and then stays live, so its subjects are held
	// through the whole window the rest of the fan-out runs in.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/warm.ts', 'src/shared.ts'], mustExecute: ['src/warm.ts'] },
		{ subjects: ['src/waiter.ts', 'src/shared.ts'], mustExecute: ['src/waiter.ts'] },
		{ subjects: ['src/free1.ts'], mustExecute: ['src/free1.ts'] },
		{ subjects: ['src/free2.ts'], mustExecute: ['src/free2.ts'] },
	];

	const { reports, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(reports.length).toBe(4);
	// the groups sharing nothing with the warm writer spawn while it runs
	expect(log.indexOf('start:src/free1.ts')).toBeLessThan(log.indexOf('end:src/warm.ts'));
	expect(log.indexOf('start:src/free2.ts')).toBeLessThan(log.indexOf('end:src/warm.ts'));
	// the group sharing one of its subjects waits for it to settle
	expect(log.indexOf('start:src/waiter.ts')).toBeGreaterThan(log.indexOf('end:src/warm.ts'));
});

test('runWriterBatches: a writer that throws surfaces its error only once the writers beside it have settled', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
				await delay(60);

				return answered(workReport());
			}

			if (file === 'src/thrower.ts') {
				throw new Error('harness crashed');
			}

			await delay(60);

			return answered(workReport());
		},
	});
	// The thrower dies while both of its siblings are mid-flight: the step may
	// not reject while a harness process is still live.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/warm.ts'], mustExecute: ['src/warm.ts'] },
		{ subjects: ['src/thrower.ts'], mustExecute: ['src/thrower.ts'] },
		{ subjects: ['src/sibling.ts'], mustExecute: ['src/sibling.ts'] },
	];

	const settled = await runWriterBatches({ run, groups, planContent: '# Plan' }).then(
		() => ({ message: 'resolved', seen: [...log] }),
		(error: unknown) => ({ message: error instanceof Error ? error.message : String(error), seen: [...log] }),
	);

	expect(settled.message).toBe('harness crashed');
	// both siblings had already settled at the moment the error surfaced
	expect(settled.seen).toEqual(expect.arrayContaining(['end:src/warm.ts', 'end:src/sibling.ts']));
});

test('runWriterBatches: two writers that throw surface the error of the one that died first', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
				await delay(60);

				return answered(workReport());
			}

			await delay(file === 'src/early.ts' ? 10 : 30);

			throw new Error(file === 'src/early.ts' ? 'early crashed' : 'late crashed');
		},
	});
	// Two throwers with staggered deaths: the second must not overwrite the
	// error the step is holding for the caller.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/warm.ts'], mustExecute: ['src/warm.ts'] },
		{ subjects: ['src/early.ts'], mustExecute: ['src/early.ts'] },
		{ subjects: ['src/late.ts'], mustExecute: ['src/late.ts'] },
	];

	const settled = await runWriterBatches({ run, groups, planContent: '# Plan' }).then(
		() => ({ message: 'resolved', seen: [...log] }),
		(error: unknown) => ({ message: error instanceof Error ? error.message : String(error), seen: [...log] }),
	);

	// the earlier death wins, and the later thrower had still been given its slot
	expect(settled.message).toBe('early crashed');
	expect(settled.seen).toEqual(expect.arrayContaining(['start:src/late.ts', 'end:src/warm.ts']));
});
