import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import type { LightsoutConfig } from '@/contracts';
import { resolveStandardsPackages } from '@/standardsPackages';

const baseConfig: LightsoutConfig = { scripts: { check: 'true', testUnit: 'true', testCoverage: false } };

/** A temp consumer repo — relative package roots resolve against it. */
const setupRepo = () => ({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-resolve-packages-')) });

/**
 * A one-rule standards package written under `at`, absolute or repo-relative.
 * `ruleId` is what the package claims, so two packages can be made to collide.
 */
const setupPackage = ({ cwd, at, name, ruleId }: { cwd: string; at: string; name: string; ruleId: string }) => {
	const packagePath = join(cwd, at);
	const rulePath = `code/demo/01-${ruleId}`;
	const files: Record<string, string> = {
		'lightsout-standards.json': `{ "name": "${name}", "formatVersion": 1 }\n`,
		'code/demo/document.md': '# Demo\n\nThe document the rule argues under.\n',
		[`${rulePath}/rule.md`]: '---\nsummary: a rule the package declares\n---\n\nThe rule prose.\n',
		[`${rulePath}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
		[`${rulePath}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
	};

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packagePath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { packagePath };
};

describe('resolveStandardsPackages', () => {
	test('loads the package the plugin ships when the config names none', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPackages({ cwd, config: baseConfig });

		// unspecified is a real request for the defaults, not silence
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.name).toBe('lightsout-defaults');
	});

	test('an absent config loads the defaults the same way', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPackages({ cwd });

		expect(loaded[0]?.name).toBe('lightsout-defaults');
	});

	test('loads nothing at all when packages are turned off explicitly', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPackages({ cwd, config: { ...baseConfig, standardsPackages: false } });

		expect(loaded).toStrictEqual([]);
	});

	test('an empty list of roots loads nothing rather than falling back to the defaults', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPackages({ cwd, config: { ...baseConfig, standardsPackages: [] } });

		// a list is a list even when it is empty — only an absent key asks for the defaults
		expect(loaded).toStrictEqual([]);
	});

	test('loads exactly the declared roots, in config order, resolving relative ones against the repo', async () => {
		const { cwd } = setupRepo();

		setupPackage({ cwd, at: 'standards/house', name: 'house', ruleId: 'house-rule' });

		const { packagePath } = setupPackage({ cwd, at: 'standards/team', name: 'team', ruleId: 'team-rule' });
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/house', packagePath] };

		const loaded = await resolveStandardsPackages({ cwd, config });

		// the bundled default is replaced, not stacked under, what the config lists
		expect(loaded.map((pkg) => pkg.name)).toStrictEqual(['house', 'team']);
		// an absolute entry is taken as written
		expect(loaded[1]?.rootPath).toBe(packagePath);
	});

	test('two packages claiming one rule id are refused, with both packages named', async () => {
		const { cwd } = setupRepo();

		setupPackage({ cwd, at: 'standards/house', name: 'house', ruleId: 'shared-rule' });
		setupPackage({ cwd, at: 'standards/team', name: 'team', ruleId: 'shared-rule' });

		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/house', 'standards/team'] };

		const error = await getRejectionError({ promise: resolveStandardsPackages({ cwd, config }) });

		// an ambiguous id would make a config override and a site key mean two things
		expect(error.message).toContain('duplicate rule id "shared-rule"');
		expect(error.message).toContain('house');
		expect(error.message).toContain('team');
	});

	test('a declared root with no package in it is a hard error naming the file it looked for', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/ghost'] };

		const error = await getRejectionError({ promise: resolveStandardsPackages({ cwd, config }) });

		expect(error.message).toContain('standards package root file not found');
		expect(error.message).toContain(join(cwd, 'standards/ghost', 'lightsout-standards.json'));
	});

	test('reports the first unloadable root, not a later one, when several are broken', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/ghost', 'standards/phantom'] };

		const error = await getRejectionError({ promise: resolveStandardsPackages({ cwd, config }) });

		// roots load one at a time in config order, so the author fixes the first fault first
		expect(error.message).toContain(join(cwd, 'standards/ghost', 'lightsout-standards.json'));
		expect(error.message).not.toContain('phantom');
	});

	test('a package that fails its own load stops the run even when every other root is sound', async () => {
		const { cwd } = setupRepo();

		setupPackage({ cwd, at: 'standards/house', name: 'house', ruleId: 'house-rule' });
		mkdirSync(join(cwd, 'standards/empty'), { recursive: true });
		writeFileSync(join(cwd, 'standards/empty', 'lightsout-standards.json'), '{ "name": "empty", "formatVersion": 1 }\n');

		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/house', 'standards/empty'] };

		const error = await getRejectionError({ promise: resolveStandardsPackages({ cwd, config }) });

		// a consumer that declared standards and did not get them must not run
		expect(error.message).toContain('standards package failed to load');
		expect(error.message).toContain(join(cwd, 'standards/empty'));
	});
});
