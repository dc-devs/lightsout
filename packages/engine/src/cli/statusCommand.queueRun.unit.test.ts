import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { PipelineKind, type QueueBoard, type QueueBoardTicket, QueueLane, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

// Nothing is mocked here, the queue run resolver included: every case either
// names its queue run with `--run` or holds the checkout's run lock under this
// process, so the resolver answers at its first look and never spends the
// minute it waits for a queue that has not started yet.

/** The queue coordinator run each case names or locks — a full id, so its first eight characters are what a report prints. */
const queueRunId = 'a11ce0de-0000-4000-8000-000000000000';

/** A run that is not a queue run, or whose manifest does not read, named by its shortened id. */
const otherRunId = 'b0b0b0b0-0000-4000-8000-000000000000';

/** The one engine run a Building ticket's worktree holds. */
const worktreeRunId = 'c4c4c4c4-0000-4000-8000-000000000000';

/** When the board was last written: local 10:12, the time a stopped board's heading shows. */
const boardUpdatedAt = new Date(2026, 8, 10, 10, 12).toISOString();

const headerRow = '| Build Queue | Building | Ship Queue | Shipping Now | Shipped | Parked | Blocked |';
const separatorRow = '| --- | --- | --- | --- | --- | --- | --- |';
const liveHeading = expect.stringMatching(/^Queue update · \d{2}:\d{2} · next update \d{2}:\d{2}$/);

/** A ticket waiting for a build worker: on the board, never active. */
const waitingTicket: QueueBoardTicket = { identifier: 'EX-101', title: 'Notifications', lane: QueueLane.BuildQueue, enteredAt: '2026-09-10T08:56:00.000Z' };

/** A Building ticket with no worktree recorded: active on a live board, where it would get a notice block. */
const unboundBuildingTicket: QueueBoardTicket = {
	identifier: 'EX-102',
	title: 'API changes',
	lane: QueueLane.Building,
	enteredAt: '2026-09-10T09:00:00.000Z',
};

/** The ticket the ship lane holds, with a worktree but no branch recorded — nothing a shipping record could be read for. */
const branchlessShippingTicket: QueueBoardTicket = {
	identifier: 'EX-104',
	title: 'Exports',
	lane: QueueLane.ShippingNow,
	worktreePath: '/tmp/worktrees/ex-104-exports',
	enteredAt: '2026-09-10T09:20:00.000Z',
};

const contextOf = ({ cwd, args }: { cwd: string; args: Record<string, string | true> }) => ({
	flags: new Map<string, string | true>(Object.entries(args)),
	rest: [],
	cwd,
});

/** The lines between the output's `text` fence and the fence that closes it. */
const fencedLines = ({ logged }: { logged: string[] }) => {
	const open = logged.indexOf('```text');

	return logged.slice(open + 1, logged.indexOf('```', open + 1));
};

/**
 * A real main checkout holding the queue coordinator run with the given status,
 * the board it wrote when `tickets` is given, and its run lock under this live
 * process when `locked`. Output is captured from here on.
 */
const setupQueueCheckout = async ({
	args,
	status = RunStatus.Running,
	locked = false,
	tickets,
}: {
	args: Record<string, string | true>;
	status?: RunStatus;
	locked?: boolean;
	/** The board the queue run wrote; absent for a queue run that has written none yet. */
	tickets?: QueueBoardTicket[];
}) => {
	const cwd = await freshCwd();
	const runDir = await seedRunDir({ cwd, manifest: { runId: queueRunId, pipeline: PipelineKind.Queue, status } });
	const boardPath = join(runDir, 'board.json');

	if (tickets !== undefined) {
		const board: QueueBoard = { coordinatorRunId: queueRunId, updatedAt: boardUpdatedAt, tickets };

		await writeFile(boardPath, JSON.stringify(board), 'utf8');
	}

	if (locked) {
		const lock = { pid: process.pid, runId: queueRunId, startedAt: '2026-09-10T08:55:00.000Z' };

		await writeFile(join(cwd, '.lightsout', 'lock.json'), JSON.stringify(lock), 'utf8');
	}

	const captured = captureCommandOutput();

	return { context: contextOf({ cwd, args }), boardPath, ...captured };
};

/**
 * A live queue whose one active ticket is Building in a worktree holding one failed run and no lock. The ticket
 * records no build start, so the run is bound from when it entered the lane. `expected` is `status --run` for that
 * run in that worktree, minus its leading blank line.
 */
const setupLiveBuildingQueue = async () => {
	const worktree = await freshCwd();

	await seedRunDir({
		cwd: worktree,
		manifest: {
			runId: worktreeRunId,
			createdAt: '2026-09-10T09:01:00.000Z',
			updatedAt: '2026-09-10T09:04:00.000Z',
			status: RunStatus.Failed,
			steps: [{ id: 'implement', status: RunStatus.Failed, attempts: 1, durationMs: 180_000 }],
			stepOrder: ['implement', 'format'],
		},
	});

	const standalone = captureCommandOutput();

	await statusCommand(contextOf({ cwd: worktree, args: { run: worktreeRunId } })).catch((error: unknown) => {
		if (!(error instanceof Error && error.message === 'process.exit')) {
			throw error;
		}
	});

	const building: QueueBoardTicket = {
		identifier: 'EX-102',
		title: 'API changes',
		lane: QueueLane.Building,
		worktreePath: worktree,
		enteredAt: '2026-09-10T09:00:00.000Z',
	};
	const queue = await setupQueueCheckout({ args: { queue: true }, locked: true, tickets: [waitingTicket, building] });

	return { ...queue, expected: standalone.logged.slice(1) };
};

/** A checkout holding one run that `status --queue --run` cannot show as a queue: an implement run, or a manifest that does not read. */
const setupOtherRun = async ({ readable }: { readable: boolean }) => {
	const cwd = await freshCwd();

	if (readable) {
		await seedRunDir({ cwd, manifest: { runId: otherRunId, pipeline: PipelineKind.Implement } });
	} else {
		const runDir = join(cwd, '.lightsout', 'runs', otherRunId);

		await mkdir(runDir, { recursive: true });
		await writeFile(join(runDir, 'manifest.json'), 'not a manifest', 'utf8');
	}

	const captured = captureCommandOutput();

	return { context: contextOf({ cwd, args: { queue: true, run: 'b0b0b0b0' } }), ...captured };
};

describe('statusCommand', () => {
	test("a bare --queue shows the live queue run the checkout's run lock names, its board first and each active ticket's block after it", async () => {
		const { context, expected, logged, errors, exitCodes } = await setupLiveBuildingQueue();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toEqual([
			liveHeading,
			'',
			headerRow,
			separatorRow,
			'| EX-101 · Notifications | EX-102 · API changes | — | — | — | — | — |',
			'',
			'**EX-102 · API changes**',
			'',
			'```text',
			...expected,
			'```',
		]);
		// the block is the worktree run's, not the notice a ticket with no run since it entered the lane gets
		expect(expected[0]?.endsWith('c4c4c4c4')).toBe(true);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a Shipping Now ticket the board recorded no branch for gets a one-line notice in its fence', async () => {
		const { context, logged, exitCodes } = await setupQueueCheckout({ args: { queue: true }, locked: true, tickets: [branchlessShippingTicket] });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(fencedLines({ logged })).toEqual([expect.stringContaining('EX-104')]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--queue --run naming a crashed queue run shows it stopped at its last update, with no ticket active', async () => {
		const { context, logged, errors, exitCodes } = await setupQueueCheckout({
			args: { queue: true, run: 'a11ce0de' },
			tickets: [waitingTicket, unboundBuildingTicket],
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([
			'Queue stopped · last update 10:12',
			'',
			headerRow,
			separatorRow,
			'| EX-101 · Notifications | EX-102 · API changes | — | — | — | — | — |',
		]);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--queue --run naming a queue run that has written no board yet names the board file and exits 0', async () => {
		const { context, boardPath, logged, errors, exitCodes } = await setupQueueCheckout({ args: { queue: true, run: 'a11ce0de' }, locked: true });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toEqual([expect.stringContaining(boardPath)]);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--queue --run naming an implement run says on stderr that it is not a queue run and exits 1', async () => {
		const { context, logged, errors, exitCodes } = await setupOtherRun({ readable: true });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toEqual([expect.stringMatching(new RegExp(`^(?=.*${otherRunId})(?=.*not a queue run)`))]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('--queue --run naming a run whose manifest does not read says so on stderr and exits 1', async () => {
		const { context, logged, errors, exitCodes } = await setupOtherRun({ readable: false });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toEqual([expect.stringContaining(otherRunId)]);
		expect(exitCodes).toStrictEqual([1]);
	});
});
