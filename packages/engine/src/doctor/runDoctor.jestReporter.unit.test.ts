import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runDoctor } from '#src/doctor/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const passingProbe = async () => ({ exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' });

const byId = (checks: Awaited<ReturnType<typeof runDoctor>>) => new Map(checks.map((check) => [check.id, check]));

/**
 * A package whose Jest config satisfies the mock-cleanup check and says nothing
 * about the engine's reporter — so the two package-iterating checks read the
 * same config and answer differently, which is what makes "beside" observable.
 */
const setupRepoWithJestConfig = () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			'package-gates': { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
		},
	});

	mkdirSync(join(dir, 'packages/web'), { recursive: true });
	writeFileSync(join(dir, 'packages/web/package.json'), JSON.stringify({ name: '@acme/web', scripts: { check: 'x', 'test:unit': 'x' } }));
	writeFileSync(join(dir, 'packages/web/jest.config.cjs'), 'module.exports = { clearMocks: true, restoreMocks: true };\n');

	return { dir };
};

test('runDoctor: includes the jest-reporter check', async () => {
	const { dir } = setupRepoWithJestConfig();

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	expect(checks.get('jest-reporter')).toEqual(
		expect.objectContaining({
			id: 'jest-reporter',
			// the config loads no reporter, so the check has something to say
			status: 'warn',
			detail: expect.stringContaining('packages/web/jest.config.cjs'),
			// a warn always carries the change that clears it
			fix: expect.stringContaining('reporters'),
		}),
	);
	// it runs beside the mock check over the same resolved package dirs, and the
	// two judge the same config independently
	expect(checks.get('jest-mocks')?.status).toBe('pass');
});
