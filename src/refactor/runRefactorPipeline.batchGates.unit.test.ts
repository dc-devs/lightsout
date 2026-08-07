import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { readGateLog } from '@tests/helpers/readGateLog';
import { report } from '@tests/helpers/report';
import { setupMonorepo } from '@tests/helpers/setupMonorepo';

/**
 * A monorepo whose only finding sits in packages/api, and a driver that
 * splits it while snapshotting the gate log — so the gates the BATCH ran are
 * separable from the pre-flight ones.
 */
const setupMonorepoBatch = async () => {
	const dir = setupMonorepo();

	writeFileSync(join(dir, 'packages/api/src/multi.ts'), 'export const alphaThing = 1;\nexport const betaThing = 2;\n');
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	let preFlightGates: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			preFlightGates = readGateLog({ dir });
			writeFileSync(join(dir, 'packages/api/src/multi.ts'), 'export const alphaThing = 1;\n');
			writeFileSync(join(dir, 'packages/api/src/betaThing.ts'), 'export const betaThing = 2;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'packages/api/src/multi.ts', summary: 'split' },
						{ path: 'packages/api/src/betaThing.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }), batchGates: () => readGateLog({ dir }).slice(preFlightGates.length) };
};

describe('runRefactorPipeline batch gates', () => {
	test('verifies a batch against the packages it actually touched, with coverage always on', async () => {
		const { dir, driver, config, batchGates } = await setupMonorepoBatch();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);

		const gates = batchGates();

		// a refactor must not drop coverage in the package it changed: ${gates.join(',
		// ')}
		expect(gates.includes('@acme/api coverage')).toBeTruthy();
		// the untouched package's suite is never spent: ${gates.join(', ')}
		expect(gates.some((line) => line.startsWith('@acme/web '))).toBeFalsy();
	});
});
