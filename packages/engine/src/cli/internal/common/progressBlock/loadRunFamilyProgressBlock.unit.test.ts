import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadRunFamilyProgressBlock } from '#src/cli/internal/common/progressBlock/loadRunFamilyProgressBlock.ts';
import { loadRunProgressBlock } from '#src/cli/internal/common/progressBlock/loadRunProgressBlock.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { RunNotFoundError } from '#src/runState/RunNotFoundError.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** The one clock the loader and the expected blocks both read, so a running row ticks to the same value in each. */
const pinnedNow = Date.parse('2026-09-10T10:30:00.000Z');

/** The coordinator a phase child names but whose own manifest is written unreadable. */
const corruptRootId = 'dddd9999-corrupt-root';

interface SeededRun {
	runId: string;
	plan: string;
	createdAt: string;
	updatedAt: string;
	status: RunManifest['status'];
	/** The coordinator that started this run, when it is a phase child. */
	parentRunId?: string;
}

/** A run belonging to no family: no coordinator above it and no phase children below it. */
const solo: SeededRun = {
	runId: 'ssss0000-solo-run',
	plan: 'plans/solo/plan.md',
	createdAt: '2026-09-10T10:00:00.000Z',
	updatedAt: '2026-09-10T10:12:00.000Z',
	status: RunStatus.Running,
};

/** The phased plan's coordinator — one step per phase, and no lock of its own. */
const coordinator: SeededRun = {
	runId: 'cccc0000-coordinator',
	plan: 'plans/phased/plan.md',
	createdAt: '2026-09-10T10:00:00.000Z',
	updatedAt: '2026-09-10T10:05:00.000Z',
	status: RunStatus.Running,
};

/** The earliest-created child, finished, and NOT the most recently updated one. */
const firstPhase: SeededRun = {
	runId: 'pppp1111-phase-one',
	plan: 'plans/phase-one/plan.md',
	createdAt: '2026-09-10T10:01:00.000Z',
	updatedAt: '2026-09-10T10:08:00.000Z',
	status: RunStatus.Passed,
	parentRunId: coordinator.runId,
};

/** The phase that is moving, updated BEFORE its finished sibling — so a pairing by update time alone picks the wrong one. */
const goingPhase: SeededRun = {
	runId: 'qqqq2222-phase-two',
	plan: 'plans/phase-two/plan.md',
	createdAt: '2026-09-10T10:02:00.000Z',
	updatedAt: '2026-09-10T10:10:00.000Z',
	status: RunStatus.Running,
	parentRunId: coordinator.runId,
};

/** The most recently updated child, finished, and created after `firstPhase`. */
const latestPhase: SeededRun = {
	runId: 'rrrr3333-phase-three',
	plan: 'plans/phase-three/plan.md',
	createdAt: '2026-09-10T10:03:00.000Z',
	updatedAt: '2026-09-10T10:20:00.000Z',
	status: RunStatus.Passed,
	parentRunId: coordinator.runId,
};

/** A running phase child whose coordinator is the unreadable one. */
const orphanPhase: SeededRun = {
	runId: 'oooo4444-orphan-phase',
	plan: 'plans/orphan-phase/plan.md',
	createdAt: '2026-09-10T10:04:00.000Z',
	updatedAt: '2026-09-10T10:18:00.000Z',
	status: RunStatus.Running,
	parentRunId: corruptRootId,
};

const manifestOf = ({ runId, plan, createdAt, updatedAt, status, parentRunId }: SeededRun): Partial<RunManifest> & { runId: string } => ({
	runId,
	plan,
	createdAt,
	updatedAt,
	status,
	parentRunId,
	currentStep: status === RunStatus.Running ? 'implement' : null,
	steps: [{ id: 'implement', status, attempts: 1, durationMs: 60_000 }],
	stepOrder: ['implement', 'test'],
});

/**
 * A checkout holding the given runs, plus each one's block as the real
 * `loadRunProgressBlock` draws it — the lines the family loader must hand back
 * untouched. `withCorruptRoot` adds a run directory whose manifest will not
 * parse, which `listRuns` skips in silence.
 */
const setupFamily = async ({ seeded, withCorruptRoot = false }: { seeded: SeededRun[]; withCorruptRoot?: boolean }) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const cwd = await freshCwd();

	for (const run of seeded) {
		await seedRunDir({ cwd, manifest: manifestOf(run) });
	}

	if (withCorruptRoot) {
		const corruptDir = runDirFor({ cwd, runId: corruptRootId });

		await mkdir(corruptDir, { recursive: true });
		await writeFile(join(corruptDir, 'manifest.json'), '{ half-written', 'utf8');
	}

	const blocks: Record<string, string[]> = {};

	for (const run of seeded) {
		const { lines } = await loadRunProgressBlock({ cwd, runId: run.runId });

		blocks[run.runId] = lines;
	}

	return { cwd, blocks };
};

describe('loadRunFamilyProgressBlock', () => {
	test('a run with no phase children answers its own block alone', async () => {
		const { cwd, blocks } = await setupFamily({ seeded: [solo] });

		const lines = await loadRunFamilyProgressBlock({ cwd, runId: solo.runId });

		expect(lines).toStrictEqual(blocks[solo.runId]);
	});

	test('climbs from a phase child to its coordinator, prefers the going phase, and separates the two blocks with a blank line', async () => {
		const { cwd, blocks } = await setupFamily({ seeded: [coordinator, goingPhase, latestPhase] });

		const lines = await loadRunFamilyProgressBlock({ cwd, runId: goingPhase.runId });

		expect(lines).toStrictEqual([...blocks[coordinator.runId], '', ...blocks[goingPhase.runId]]);
	});

	test('with no phase going the coordinator is paired with the most recently updated child', async () => {
		const { cwd, blocks } = await setupFamily({ seeded: [coordinator, firstPhase, latestPhase] });

		const lines = await loadRunFamilyProgressBlock({ cwd, runId: coordinator.runId });

		expect(lines).toStrictEqual([...blocks[coordinator.runId], '', ...blocks[latestPhase.runId]]);
	});

	test('a phase child whose coordinator cannot be read answers its own block alone', async () => {
		const { cwd, blocks } = await setupFamily({ seeded: [orphanPhase], withCorruptRoot: true });

		const lines = await loadRunFamilyProgressBlock({ cwd, runId: orphanPhase.runId });

		expect(lines).toStrictEqual(blocks[orphanPhase.runId]);
	});

	test('a run id with no manifest on disk rejects with RunNotFoundError', async () => {
		const { cwd } = await setupFamily({ seeded: [solo] });

		await expect(loadRunFamilyProgressBlock({ cwd, runId: 'ghost-run-id' })).rejects.toThrow(RunNotFoundError);
	});
});
