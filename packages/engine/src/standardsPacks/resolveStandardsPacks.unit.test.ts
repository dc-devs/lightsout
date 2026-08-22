import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

const baseConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

interface PackSpec {
	/** Repo-relative folder the pack is written under. */
	at: string;
	name: string;
	/** The id the pack claims, so two packs can be made to collide. */
	ruleId: string;
}

/** A one-rule standards pack written under `at`. */
const writePack = ({ cwd, at, name, ruleId }: PackSpec & { cwd: string }) => {
	const packPath = join(cwd, at);
	const rulePath = `code/demo/01-${ruleId}`;
	const files: Record<string, string> = {
		'lightsout-standards.json': `{ "name": "${name}", "formatVersion": 1 }\n`,
		'code/demo/document.md': '# Demo\n\nThe document the rule argues under.\n',
		[`${rulePath}/rule.md`]: '---\nsummary: a rule the pack declares\n---\n\nThe rule prose.\n',
		[`${rulePath}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
		[`${rulePath}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
	};

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(packPath, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}
};

/** A temp consumer repo holding the given packs — relative pack roots resolve against it. */
const setupRepo = ({ packs = [] }: { packs?: PackSpec[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-resolve-packs-'));

	for (const spec of packs) {
		writePack({ cwd, ...spec });
	}

	return { cwd };
};

describe('resolveStandardsPacks', () => {
	test('loads the pack the plugin ships when the config names none', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPacks({ cwd, config: baseConfig });

		// unspecified is a real request for the defaults, not silence
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.name).toBe('lightsout-defaults');
	});

	test('an absent config loads the defaults the same way', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPacks({ cwd });

		expect(loaded[0]?.name).toBe('lightsout-defaults');
	});

	test('loads nothing at all when packs are turned off explicitly', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPacks({ cwd, config: { ...baseConfig, 'standards-packs': false } });

		expect(loaded).toStrictEqual([]);
	});

	test('an empty list of roots loads nothing rather than falling back to the defaults', async () => {
		const { cwd } = setupRepo();

		const loaded = await resolveStandardsPacks({ cwd, config: { ...baseConfig, 'standards-packs': [] } });

		// a list is a list even when it is empty — only an absent key asks for the defaults
		expect(loaded).toStrictEqual([]);
	});

	test('loads exactly the declared roots, in config order, resolving relative ones against the repo', async () => {
		const { cwd } = setupRepo({
			packs: [
				{ at: 'standards/house', name: 'house', ruleId: 'house-rule' },
				{ at: 'standards/team', name: 'team', ruleId: 'team-rule' },
			],
		});
		const teamPath = join(cwd, 'standards/team');
		const config: LightsoutConfig = { ...baseConfig, 'standards-packs': ['standards/house', teamPath] };

		const loaded = await resolveStandardsPacks({ cwd, config });

		// the bundled default is replaced, not stacked under, what the config lists
		expect(loaded.map((pkg) => pkg.name)).toStrictEqual(['house', 'team']);
		// an absolute entry is taken as written
		expect(loaded[1]?.rootPath).toBe(teamPath);
	});

	test('two packs claiming one rule id are refused, with both packs named', async () => {
		const { cwd } = setupRepo({
			packs: [
				{ at: 'standards/house', name: 'house', ruleId: 'shared-rule' },
				{ at: 'standards/team', name: 'team', ruleId: 'shared-rule' },
			],
		});
		const config: LightsoutConfig = { ...baseConfig, 'standards-packs': ['standards/house', 'standards/team'] };

		const error = await getRejectionError({ promise: resolveStandardsPacks({ cwd, config }) });

		// an ambiguous id would make a config override and a site key mean two things
		expect(error.message).toContain('duplicate rule id "shared-rule"');
		// the cross-pack header, which is what tells this apart from the clash a single pack catches at its own load
		expect(error.message).toContain('standards packs disagree about rule ids:');
		expect(error.message).toContain('house');
		expect(error.message).toContain('team');
	});

	test('a declared root with no pack in it is a hard error naming the file it looked for', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, 'standards-packs': ['standards/ghost'] };

		const error = await getRejectionError({ promise: resolveStandardsPacks({ cwd, config }) });

		expect(error.message).toContain('standards pack root file not found');
		expect(error.message).toContain(join(cwd, 'standards/ghost', 'lightsout-standards.json'));
	});

	test('reports the first unloadable root, not a later one, when several are broken', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, 'standards-packs': ['standards/ghost', 'standards/phantom'] };

		const error = await getRejectionError({ promise: resolveStandardsPacks({ cwd, config }) });

		// roots load one at a time in config order, so the author fixes the first fault first
		expect(error.message).toContain(join(cwd, 'standards/ghost', 'lightsout-standards.json'));
		expect(error.message).not.toContain('phantom');
	});

	test('a pack that fails its own load stops the run even when every other root is sound', async () => {
		const { cwd } = setupRepo({ packs: [{ at: 'standards/house', name: 'house', ruleId: 'house-rule' }] });

		mkdirSync(join(cwd, 'standards/empty'), { recursive: true });
		writeFileSync(join(cwd, 'standards/empty', 'lightsout-standards.json'), '{ "name": "empty", "formatVersion": 1 }\n');

		const config: LightsoutConfig = { ...baseConfig, 'standards-packs': ['standards/house', 'standards/empty'] };

		const error = await getRejectionError({ promise: resolveStandardsPacks({ cwd, config }) });

		// a consumer that declared standards and did not get them must not run
		expect(error.message).toContain('standards pack failed to load');
		expect(error.message).toContain(join(cwd, 'standards/empty'));
	});
});
