import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { readRunLock } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** The shape acquireRunLock writes, as raw bytes so malformed holders are expressible. */
const lockJson = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({ pid: 4242, runId: 'run-a', startedAt: '2026-07-03T00:00:00.000Z', ...overrides });

interface SetupParams {
	/** Written to .lightsout/lock.json verbatim; omitted means the repo holds no lock. */
	raw?: string;
}

const setupRunLockFile = ({ raw }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const lockPath = join(cwd, '.lightsout', 'lock.json');

	if (raw !== undefined) {
		mkdirSync(dirname(lockPath), { recursive: true });
		writeFileSync(lockPath, raw, 'utf8');
	}

	return { cwd };
};

/** Every one of these is unreadable for a different reason but answers the same way: no holder. */
const unreadableLocks = [
	{ name: 'a pid the OS could never have issued', raw: lockJson({ pid: '4242' }) },
	{ name: 'a holder with no run id to name', raw: lockJson({ runId: undefined }) },
	{ name: 'a JSON value that is not an object at all', raw: '[]' },
];

describe('readRunLock', () => {
	test('reads back the holder recorded in the repo lock file', async () => {
		const { cwd } = setupRunLockFile({ raw: lockJson() });

		const holder = await readRunLock({ cwd });

		assert.deepEqual(holder, { pid: 4242, runId: 'run-a', startedAt: '2026-07-03T00:00:00.000Z' });
	});

	test('reads no holder for a repo that has never taken the lock', async () => {
		const { cwd } = setupRunLockFile();

		const holder = await readRunLock({ cwd });

		assert.equal(holder, undefined, 'a missing lock is a free repo, not a failure');
	});

	test('reads no holder from a lock file that is not JSON at all', async () => {
		const { cwd } = setupRunLockFile({ raw: 'not json at all' });

		const holder = await readRunLock({ cwd });

		assert.equal(holder, undefined, 'an interrupted write leaves garbage the acquirer must be free to steal');
	});

	for (const { name, raw } of unreadableLocks) {
		test(`reads no holder from ${name}`, async () => {
			const { cwd } = setupRunLockFile({ raw });

			const holder = await readRunLock({ cwd });

			assert.equal(holder, undefined);
		});
	}

	test('drops fields it does not know, so a lock written by a newer version still names its holder', async () => {
		const { cwd } = setupRunLockFile({ raw: lockJson({ hostname: 'laptop', command: 'implement' }) });

		const holder = await readRunLock({ cwd });

		assert.deepEqual(holder, { pid: 4242, runId: 'run-a', startedAt: '2026-07-03T00:00:00.000Z' });
	});
});
