import { describe, expect, test } from '@jest/globals';
import { GateLock } from '#src/contracts/index.ts';

/** The five fields a live holder writes to the shared `.lightsout/gate-lock.json`. */
const setupGateLock = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const lock: Record<string, unknown> = {
		pid: 4242,
		runId: 'run-1',
		worktree: '/repo/worktrees/lo-119',
		startedAt: '2026-01-01T00:00:00.000Z',
		gateGroups: [5150],
		...extra,
	};

	if (omit) {
		delete lock[omit];
	}

	return { lock };
};

describe('GateLock', () => {
	test('rejects a document without a gate-group list or with a non-integer holder pid', () => {
		const { lock: withoutGroups } = setupGateLock({ omit: 'gateGroups' });
		const { lock: fractionalPid } = setupGateLock({ extra: { pid: 4242.5 } });

		const parsedWithoutGroups = GateLock.safeParse(withoutGroups);
		const parsedFractionalPid = GateLock.safeParse(fractionalPid);

		// a document with no group list would read as a holder running no gates, and
		// the reclaim rule would hand the machine to a second run while the first
		// one's detached gates are still burning it
		expect(parsedWithoutGroups.success).toBe(false);
		// a fractional pid can never match a live process, so the dead-holder half of
		// the reclaim rule would be decided from a number the OS never issued
		expect(parsedFractionalPid.success).toBe(false);
	});
});
