import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { isProcessGroupAlive } from '#src/common/processes/isProcessGroupAlive.ts';

/** A detached shell, so its pid is also the id of the group it leads — exactly how a gate command is spawned. */
const setupDetachedChild = async () => {
	const child = spawn('sleep 30', { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

	await new Promise((resolve) => setTimeout(resolve, 100));

	return { child, pgid: child.pid ?? 0 };
};

/** Kill the whole group and wait until the leader has been reaped, so the group is really gone rather than a zombie. */
const stopGroup = async ({ child, pgid }: { child: ChildProcess; pgid: number }) => {
	try {
		process.kill(-pgid, 'SIGKILL');
	} catch {
		// already gone
	}

	await new Promise((resolve) => child.once('close', resolve));
};

describe('isProcessGroupAlive', () => {
	test("reports a detached child's group alive while it runs and dead once it has exited", async () => {
		const { child, pgid } = await setupDetachedChild();

		const whileRunning = isProcessGroupAlive({ pgid });
		await stopGroup({ child, pgid });
		const afterExit = isProcessGroupAlive({ pgid });

		// a reservation left by a killed engine is only reclaimable once the gate
		// groups it recorded are gone, so this answer decides whether a second run
		// gets the machine while the first run's suites are still burning it
		expect({ whileRunning, afterExit }).toStrictEqual({ whileRunning: true, afterExit: false });
	});
});
