import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { jest } from '@jest/globals';

/** Keep the real canonical store readable while its unowned diagnostic writes fail. */
export const rejectPlanningLocalWrites = async ({ cwd, name }: { cwd: string; name: string }) => {
	const root = join(await realpath(cwd), '.lightsout', 'plans', name, '.planning', 'local');
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const open = actual.open;
	let unavailable = true;
	let failures = 0;
	jest.spyOn(actual, 'open').mockImplementation(async (...args) => {
		if (unavailable && dirname(String(args[0])) === root && args[1] === 'wx') {
			failures++;
			throw Object.assign(new Error('Diagnostic storage writes unavailable'), { code: 'EIO' });
		}
		return open(...args);
	});
	return {
		restore: async () => {
			unavailable = false;
		},
		failures: () => failures,
	};
};
