import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, test } from '@jest/globals';
import { resolveQueueRun } from '#src/cli/common/queueBoard/resolveQueueRun.ts';
import { PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** Beyond any OS pid range — the live-process probe reports it dead. */
const deadPid = 999_999_999;

type PlantedRun = Partial<RunManifest> & { runId: string };

/** A main checkout whose runs directory holds exactly the planted manifests, and whose run lock is written on demand. */
const setupCheckout = async () => {
	const cwd = await freshCwd();

	const plant = async ({ runId, ...overrides }: PlantedRun) => {
		await seedRunDir({ cwd, manifest: { runId, ...overrides } });
	};

	/** The main checkout's run lock — the file the queue's live process is recognised by. */
	const lock = async ({ runId, pid }: { runId: string; pid: number }) => {
		await mkdir(join(cwd, '.lightsout'), { recursive: true });
		await writeFile(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid, runId, startedAt: '2026-01-01T00:00:00.000Z' }), 'utf8');
	};

	/** A live queue run that writes its manifest, then takes the lock, only after the given delay — as a just-launched queue does. */
	const startQueueLater = async ({ runId, afterMs }: { runId: string; afterMs: number }) => {
		await delay(afterMs);
		await plant({ runId, pipeline: PipelineKind.Queue, status: RunStatus.Running });
		await lock({ runId, pid: process.pid });
	};

	return { cwd, plant, lock, startQueueLater };
};

describe('resolveQueueRun', () => {
	test("follows the queue run the main checkout's run lock names while its process is alive", async () => {
		const { cwd, plant, lock } = await setupCheckout();

		await plant({ runId: 'queue-live', pipeline: PipelineKind.Queue, status: RunStatus.Running });
		await lock({ runId: 'queue-live', pid: process.pid });

		const listing = await resolveQueueRun({ cwd, graceMs: 0 });

		expect(listing).toEqual(expect.objectContaining({ runId: 'queue-live', pipeline: 'queue', live: true }));
	});

	test('ignores a live lock held by a run that is not a queue run', async () => {
		const { cwd, plant, lock } = await setupCheckout();

		await plant({ runId: 'implement-live', pipeline: PipelineKind.Implement, status: RunStatus.Running });
		await lock({ runId: 'implement-live', pid: process.pid });

		const listing = await resolveQueueRun({ cwd, graceMs: 0 });

		expect(listing).toBeUndefined();
	});

	test("answers with nothing when the lock's process is gone, rather than the newest queue run", async () => {
		const { cwd, plant, lock } = await setupCheckout();

		await plant({
			runId: 'queue-crashed',
			pipeline: PipelineKind.Queue,
			status: RunStatus.Running,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:01:00.000Z',
		});
		await plant({
			runId: 'queue-newer',
			pipeline: PipelineKind.Queue,
			status: RunStatus.Running,
			createdAt: '2026-01-01T00:05:00.000Z',
			updatedAt: '2026-01-01T00:06:00.000Z',
		});
		await lock({ runId: 'queue-crashed', pid: deadPid });

		const listing = await resolveQueueRun({ cwd, graceMs: 0 });

		expect(listing).toBeUndefined();
	});

	test('waits within the grace period for a queue run that has not taken the lock yet', async () => {
		const { cwd, startQueueLater } = await setupCheckout();
		const arrival = startQueueLater({ runId: 'queue-late', afterMs: 100 });

		const listing = await resolveQueueRun({ cwd, graceMs: 2_000, pollMs: 20 });
		await arrival;

		expect(listing).toEqual(expect.objectContaining({ runId: 'queue-late', live: true }));
	});

	test("returns the named run's listing without waiting when a run id is given", async () => {
		const { cwd, plant } = await setupCheckout();

		await plant({ runId: 'queue-passed', pipeline: PipelineKind.Queue, status: RunStatus.Passed });

		const started = Date.now();
		const listing = await resolveQueueRun({ cwd, runId: 'queue-passed', graceMs: 60_000 });
		const elapsedMs = Date.now() - started;

		expect({ listing, waited: elapsedMs >= 1_000 }).toEqual({
			listing: expect.objectContaining({ runId: 'queue-passed', live: false, status: 'passed' }),
			waited: false,
		});
	});
});
