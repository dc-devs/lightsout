import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { checkLintRules } from '@/doctor/checkLintRules';

const config: LightsoutConfig = { scripts: { check: 'true', testUnit: 'true', testCoverage: false } };

/** A package directory holding the given lint config files. */
const setupPackage = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-lint-rules-'));

	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}

	return { packageDirs: [{ label: 'api', dir }], dir };
};

describe('checkLintRules', () => {
	test('says nothing when the consumer has turned standards off', async () => {
		const { packageDirs } = setupPackage({ files: { 'biome.json': '{}' } });

		// no standards means no mechanical rules to enforce them
		expect(await checkLintRules({ config: { ...config, standardsPackages: false }, packageDirs })).toBe(undefined);
	});

	test('flags a biome config that does not enforce the rules the standards assume', async () => {
		const { packageDirs } = setupPackage({ files: { 'biome.json': '{ "linter": {} }' } });

		const check = await checkLintRules({ config, packageDirs });

		expect(check?.status).toBe('note');
		expect(check?.detail ?? '').toMatch(/useImportType, noExplicitAny missing or disabled/);
	});

	test('treats a rule explicitly turned off the same as a missing one', async () => {
		const { packageDirs } = setupPackage({ files: { 'biome.json': '{ "useImportType": "off", "noExplicitAny": "error" }' } });

		const check = await checkLintRules({ config, packageDirs });

		// a rule set to off is not enforcement, however present its name is
		expect(check?.detail ?? '').toMatch(/useImportType/);
		expect(check?.detail ?? '').not.toMatch(/noExplicitAny/);
	});

	test('passes an eslint config that names both rules', async () => {
		const { packageDirs } = setupPackage({ files: { 'eslint.config.js': "export default [{ rules: { 'consistent-type-imports': 'error', 'no-explicit-any': 'error' } }];" } });

		expect((await checkLintRules({ config, packageDirs }))?.status).toBe('pass');
	});

	test('a package directory that is not there contributes nothing rather than failing the doctor', async () => {
		// the doctor is a diagnosis, so a directory that vanished under it holds no
		// lint config to read, never a crash
		const check = await checkLintRules({ config, packageDirs: [{ label: 'ghost', dir: '/lightsout/no/such/package' }] });

		expect(check?.status).toBe('note');
		expect(check?.detail ?? '').toMatch(/no linter config found/);
	});

	test('an unreadable lint config is treated as enforcing nothing', async () => {
		const { packageDirs, dir } = setupPackage();

		// a directory where the file should be: readable as an entry, not as text
		mkdirSync(join(dir, 'biome.json'));

		const check = await checkLintRules({ config, packageDirs });

		expect(check?.detail ?? '').toMatch(/useImportType, noExplicitAny missing or disabled/);
	});

	test('recognises a legacy .eslintrc as a lint config too', async () => {
		const { packageDirs } = setupPackage({ files: { '.eslintrc.json': '{ "rules": {} }' } });

		const check = await checkLintRules({ config, packageDirs });

		// an older config still governs the repo, so it is still held to the rules
		expect(check?.detail ?? '').toMatch(/consistent-type-imports, no-explicit-any missing or disabled/);
	});
});
