import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { checkJestReporter } from '#src/doctor/checkJestReporter.ts';

// A config that loads whatever the engine names in the reporter variable — the
// one conditional entry a consumer adds. The variable's name is written out
// rather than imported, so the test states the contract independently.
const loadsReporter = [
	'const reporter = process.env.LIGHTSOUT_JEST_REPORTER;',
	"module.exports = { reporters: reporter ? ['default', reporter] : ['default'] };",
].join('\n');

const ignoresReporter = "module.exports = { reporters: ['default'] };";

/** A repository whose packages each hold the given jest config, or none when undefined. */
const setupRepo = ({ packages = {} }: { packages?: Record<string, string | undefined> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-jest-reporter-'));

	const packageDirs = Object.entries(packages).map(([label, config]) => {
		const dir = join(cwd, 'packages', label);
		mkdirSync(dir, { recursive: true });

		if (config !== undefined) {
			writeFileSync(join(dir, 'jest.config.cjs'), config);
		}

		return { label, dir };
	});

	return { cwd, packageDirs };
};

describe('checkJestReporter', () => {
	test("checkJestReporter: warns for a jest config whose reporters do not load the engine's reporter, and passes one that does", async () => {
		const mixed = setupRepo({ packages: { alpha: loadsReporter, omega: ignoresReporter } });

		const warned = await checkJestReporter(mixed);

		expect(warned).toEqual(expect.objectContaining({ id: 'jest-reporter', status: 'warn', detail: expect.stringContaining('omega') }));
		expect(warned?.detail).not.toContain('alpha');
		expect(warned?.fix ?? '').toContain('LIGHTSOUT_JEST_REPORTER');

		const complete = setupRepo({ packages: { alpha: loadsReporter } });

		const passed = await checkJestReporter(complete);

		expect(passed).toEqual(expect.objectContaining({ id: 'jest-reporter', status: 'pass' }));
	});

	test('checkJestReporter: reports an unloadable jest config as unchecked', async () => {
		const broken = setupRepo({ packages: { alpha: 'module.exports = {' } });

		const check = await checkJestReporter(broken);

		expect(check?.detail ?? '').toMatch(/alpha[\s\S]*unchecked|unchecked[\s\S]*alpha/i);
		expect(check?.status).not.toBe('fail');
	});

	test('checkJestReporter: reports a config exporting a function or a promise as unchecked, never as missing', async () => {
		const factories = setupRepo({
			packages: { alpha: 'module.exports = () => ({ reporters: [] });', beta: 'module.exports = Promise.resolve({ reporters: [] });' },
		});

		const check = await checkJestReporter(factories);

		// neither shape can be read synchronously, so nothing is known about it either way
		expect(check?.status).toBe('pass');
		expect(check?.detail ?? '').toMatch(/alpha[\s\S]*unchecked/);
		expect(check?.detail ?? '').toMatch(/beta[\s\S]*unchecked/);
	});

	test('checkJestReporter: reports nothing when the repository has no jest config', async () => {
		const bare = setupRepo({ packages: { alpha: undefined } });

		const check = await checkJestReporter(bare);

		expect(check).toBe(undefined);
	});
});
