import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { RunStatus, type ShippingProgress, ShippingStepId } from '#src/contracts/index.ts';
import { getShippingProgressPath } from '#src/ship/progress/common/utils/getShippingProgressPath.ts';

type ShippingStepRecord = ShippingProgress['steps'][number];

/** The steps a new attempt runs again. Sync is not among them: only a confirmed merge earns it, once. */
const attemptSteps: ShippingStepId[] = [ShippingStepId.Integrate, ShippingStepId.Push, ShippingStepId.PullRequest, ShippingStepId.Checks, ShippingStepId.Merge];

const pendingSteps = () => Object.values(ShippingStepId).map((id) => ({ id, status: RunStatus.Pending }));

const freshRecord = ({ branch, maxAttempts }: { branch: string; maxAttempts: number }) => {
	const now = new Date().toISOString();

	return { branch, attempt: 1, maxAttempts, pid: process.pid, startedAt: now, updatedAt: now, steps: pendingSteps() };
};

/**
 * The folder ignores everything in it, its own ignore file included, so the
 * integration step's `git add -A` never stages the record into a release
 * candidate and its `git clean -fd` never deletes it — whatever the
 * repository's own ignore rules cover. Anything at that path that is not a file
 * is written over, which fails, and the caller skips its record write.
 */
const ensureIgnoreFile = async ({ folder }: { folder: string }) => {
	const ignorePath = join(folder, '.gitignore');
	const isFile = await stat(ignorePath).then(
		(found) => found.isFile(),
		() => false,
	);

	if (!isFile) {
		await writeFile(ignorePath, '*\n', 'utf8');
	}
};

/** One whole record, written through a temporary sibling file and renamed into place, never into a folder without its ignore file. */
const writeRecord = async ({ recordPath, record }: { recordPath: string; record: ShippingProgress }) => {
	const folder = dirname(recordPath);
	const tmpPath = `${recordPath}.tmp`;

	try {
		await mkdir(folder, { recursive: true });
		await ensureIgnoreFile({ folder });
		await writeJsonFile({ path: tmpPath, value: record });
		await rename(tmpPath, recordPath);
	} catch {
		// Swallowed on purpose, with no progress line: a ship's result, ordering and
		// output must never depend on this record. The next write tries again.
	}
};

interface ConstructorParams {
	/** The checkout being shipped. */
	cwd: string;
	/** The branch as git names it. */
	branch: string;
	/** The ship's own bound on attempts. */
	maxAttempts: number;
}

/**
 * Writes the ship sequence's own step progress to its shipping record, for
 * `lightsout status --shipping` to read while the ship is still going.
 *
 * The record lives in memory and is rewritten whole on every change, one write
 * at a time and in call order. Only `end` returns a promise: every other method
 * queues its write and returns at once, so a slow disk never delays a ship
 * step, and a failed write is dropped without a word.
 */
export class ShippingProgressRecorder {
	private readonly recordPath: string;
	private record: ShippingProgress;
	private writes: Promise<void> = Promise.resolve();

	constructor({ cwd, branch, maxAttempts }: ConstructorParams) {
		this.recordPath = getShippingProgressPath({ cwd, branch });
		this.record = freshRecord({ branch, maxAttempts });
	}

	/** Attempt 1 starts a fresh record, replacing any an earlier ship of the branch left; a later one runs the five attempt steps again under the same start time. */
	beginAttempt({ attempt }: { attempt: number }): void {
		const { branch, maxAttempts } = this.record;

		this.record =
			attempt === 1
				? freshRecord({ branch, maxAttempts })
				: {
						...this.record,
						attempt,
						steps: this.record.steps.map((step) => (attemptSteps.includes(step.id) ? { id: step.id, status: RunStatus.Pending } : step)),
					};
		this.save();
	}

	startStep({ step }: { step: ShippingStepId }): void {
		this.updateStep({ step, update: () => ({ id: step, status: RunStatus.Running, startedAt: new Date().toISOString() }) });
	}

	finishStep({ step, passed }: { step: ShippingStepId; passed: boolean }): void {
		const finishedAt = Date.now();

		this.updateStep({
			step,
			update: (current) => ({
				...current,
				status: passed ? RunStatus.Passed : RunStatus.Failed,
				durationMs: current.startedAt === undefined ? 0 : finishedAt - Date.parse(current.startedAt),
			}),
		});
	}

	noteProgress({ message }: { message: string }): void {
		this.record = { ...this.record, lastProgress: message };
		this.save();
	}

	/** Stamps the end, and resolves once every queued write has landed or been dropped. */
	end(): Promise<void> {
		this.record = { ...this.record, endedAt: new Date().toISOString() };
		this.save();

		return this.writes;
	}

	private updateStep({ step, update }: { step: ShippingStepId; update: (current: ShippingStepRecord) => ShippingStepRecord }) {
		this.record = { ...this.record, steps: this.record.steps.map((current) => (current.id === step ? update(current) : current)) };
		this.save();
	}

	/** Stamps the change and queues a whole-record write behind the ones already queued. Each write holds its own snapshot, because `record` is replaced rather than mutated. */
	private save() {
		const record: ShippingProgress = { ...this.record, pid: process.pid, updatedAt: new Date().toISOString() };
		const recordPath = this.recordPath;

		this.record = record;
		this.writes = this.writes.then(() => writeRecord({ recordPath, record }));
	}
}
