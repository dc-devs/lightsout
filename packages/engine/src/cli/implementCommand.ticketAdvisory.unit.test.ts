import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { queueConfigBlock, ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The advisory that fires before the run banner when a plan folder's own name
// carries no ticket id. Every case here turns on the folder's NAME and on
// whether the repo declared a tracker at all, so no case needs a plan the
// pipeline can actually run — each run stops a line or two later, on a missing
// plan file or on a planted lock, and the advisory has already been said or not
// said by then.

/**
 * A consumer repo whose `--plan` names nothing real, so the run renders its
 * advisory and its banner and then stops without spawning a harness.
 *
 * `config` is what decides whether the repo chose a ticket convention, which is
 * the only thing these cases vary besides the plan path. `locked` plants a live
 * run lock, which is how a folder holding a REAL plan.md stops just as early.
 */
const setupImplement = ({ args, config, locked }: { args: string[]; config: Record<string, unknown>; locked?: boolean }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config });

	if (locked) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/**
 * A repo that declares a tracker, with a plan workspace seeded under
 * `.lightsout/plans/<name>` — the arrangement the plan-folder advisory is
 * about, where the case turns on the folder's own name rather than on what the
 * folder holds. The planted lock ends the run right after the advisory, so
 * nothing spawns a harness. `--plan` names the folder, or the plan.md in it.
 * `trackerConfigured: false` leaves the queue block standing alone, which is a
 * repo that named no tracker at all.
 */
const setupNamedPlanFolder = ({
	name,
	pointAtPlanFile = false,
	trackerConfigured = true,
}: {
	name: string;
	pointAtPlanFile?: boolean;
	trackerConfigured?: boolean;
}) => {
	const folder = join('.lightsout', 'plans', name);
	const setup = setupImplement({
		args: ['--plan', pointAtPlanFile ? join(folder, 'plan.md') : folder],
		locked: true,
		config: trackerConfigured ? { queue: queueConfigBlock, 'ticket-tracker': ticketTrackerConfigBlock } : { queue: queueConfigBlock },
	});

	mkdirSync(join(setup.cwd, folder), { recursive: true });
	writeFileSync(join(setup.cwd, folder, 'plan.md'), '# Plan: add feature\n');

	return setup;
};

test('implementCommand: a plan folder carrying no ticket id is advised once, ahead of the run banner, and the run goes on unchanged', async () => {
	const { context, logged, errors, exitCodes } = setupNamedPlanFolder({ name: 'rate-limit-banner' });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// the advisory reads as a note about the plan being started, not as an
	// interruption inside the run header
	expect(logged[0] ?? '').toMatch(/plan folder 'rate-limit-banner' carries no ticket id/);
	expect(logged[1]).toBe('lightsout: starting run');
	// nothing downstream can see it: the planted lock is still what ends the run
	expect(errors.some((line) => /another lightsout run is active in this repo/.test(line))).toBeTruthy();
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a repo whose config names a queue but no ticket-tracker chose no ticket convention, so its folder name is not judged', async () => {
	const { context, logged, exitCodes } = setupNamedPlanFolder({ name: 'rate-limit-banner', trackerConfigured: false });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	// the queue block alone is not a tracker: the run opens on its own banner
	expect(logged[0]).toBe('lightsout: starting run');
	expect(logged.some((line) => /carries no ticket id/.test(line))).toBeFalsy();
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a --plan naming the plan.md inside a folder named after its ticket is told nothing', async () => {
	const { context, logged, exitCodes } = setupNamedPlanFolder({ name: 'lo-52-status-progress', pointAtPlanFile: true });

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[0]).toBe('lightsout: starting run');
	expect(exitCodes).toStrictEqual([1]);
});

test('implementCommand: a --plan outside the plans directory is no plan workspace, so its folder name is nobody’s convention to keep', async () => {
	const { context, logged, exitCodes } = setupImplement({
		args: ['--plan', 'ghost.md'],
		config: { queue: queueConfigBlock, 'ticket-tracker': ticketTrackerConfigBlock },
	});

	await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[0]).toBe('lightsout: starting run');
	expect(exitCodes).toStrictEqual([1]);
});
