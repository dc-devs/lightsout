import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { checkJestMocks } from '@/doctor/checkJestMocks';

/** A package directory holding the given files, keyed by path relative to it. */
const setupPackage = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-jest-mocks-'));

	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}

	return { cwd, packageDirs: [{ label: 'api', dir: cwd }] };
};

describe('checkJestMocks', () => {
	test('says nothing when the package has no Jest config to have an opinion about', async () => {
		const { cwd, packageDirs } = setupPackage();

		expect(await checkJestMocks({ cwd, packageDirs })).toBe(undefined);
	});

	test('passes a root config that clears and restores mocks', async () => {
		const { cwd, packageDirs } = setupPackage({ files: { 'jest.config.js': 'module.exports = { clearMocks: true, restoreMocks: true };' } });

		expect((await checkJestMocks({ cwd, packageDirs }))?.status).toBe('pass');
	});

	test('names the flags a config is missing, because the standards assume them', async () => {
		const { cwd, packageDirs } = setupPackage({ files: { 'jest.config.js': 'module.exports = { clearMocks: true };' } });

		const check = await checkJestMocks({ cwd, packageDirs });

		expect(check?.detail ?? '').toMatch(/lacks restoreMocks/);
	});

	test('finds a config nested under tests/, not just the one at the root', async () => {
		const { cwd, packageDirs } = setupPackage({ files: { 'tests/config/jest.config.cjs': 'module.exports = {};' } });

		const check = await checkJestMocks({ cwd, packageDirs });

		// a repo that keeps its Jest config in tests/ must not sit in a blind spot
		expect(check?.detail ?? '').toMatch(/lacks clearMocks, restoreMocks/);
	});

	test('a package directory that is not there yields no configs rather than failing', async () => {
		const check = await checkJestMocks({ cwd: '/lightsout', packageDirs: [{ label: 'ghost', dir: '/lightsout/no/such/package' }] });

		expect(check).toBe(undefined);
	});

	test('a config that cannot be read counts as declaring neither flag', async () => {
		const { cwd, packageDirs } = setupPackage();

		// a directory standing where the config file should be
		mkdirSync(join(cwd, 'jest.config.js'));

		const check = await checkJestMocks({ cwd, packageDirs });

		expect(check?.detail ?? '').toMatch(/lacks clearMocks, restoreMocks/);
	});
});
