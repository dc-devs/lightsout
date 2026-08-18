import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import type { LightsoutConfig } from '@/contracts';
import { resolveStandards } from '@/standards';

const baseConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/** A temp consumer repo holding the given repo-relative files. */
const setupRepo = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-resolve-standards-'));

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(cwd, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { cwd };
};

/** One rule folder's files: its markdown plus the fixture pair every rule ships. */
const ruleFiles = ({ path, summary }: { path: string; summary: string }) => ({
	[`${path}/rule.md`]: `---\nsummary: ${summary}\n---\n\n${summary} — the rule's prose.\n`,
	[`${path}/fixtures/pass/src/example.ts`]: 'export const example = 1;\n',
	[`${path}/fixtures/fail/src/example.ts`]: 'export const example = 2;\n',
});

/**
 * A standards package under `at` in the consumer repo, carrying one base
 * document per set plus a react-channel code document — enough to tell the two
 * sets apart and to watch channel gating decide what loads. Rule ids carry the
 * package name so two of these can be loaded side by side.
 */
const packageFiles = ({ at, name }: { at: string; name: string }) => ({
	[`${at}/lightsout-standards.json`]: `{ "name": "${name}", "formatVersion": 1 }\n`,
	[`${at}/code/house-style/document.md`]: `# ${name} code\n\nHow this house writes code.\n`,
	...ruleFiles({ path: `${at}/code/house-style/01-${name}-tabs`, summary: 'indent with tabs' }),
	[`${at}/code/react-style/document.md`]: '---\nchannel: react\n---\n\n# React code\n\nHow this house writes components.\n',
	...ruleFiles({ path: `${at}/code/react-style/01-${name}-hooks-first`, summary: 'hooks come before handlers' }),
	[`${at}/tests/house-tests/document.md`]: `# ${name} tests\n\nHow this house writes tests.\n`,
	...ruleFiles({ path: `${at}/tests/house-tests/01-${name}-one-assert`, summary: 'one behaviour per test' }),
});

/**
 * A standards package under `at` carrying a code set and no tests set at all —
 * a package is free to ship one set, and the stack has to notice the gap rather
 * than paper over it.
 */
const codeOnlyPackageFiles = ({ at, name }: { at: string; name: string }) => ({
	[`${at}/lightsout-standards.json`]: `{ "name": "${name}", "formatVersion": 1 }\n`,
	[`${at}/code/${name}-style/document.md`]: `# ${name} code\n\nHow this house lints.\n`,
	...ruleFiles({ path: `${at}/code/${name}-style/01-${name}-no-any`, summary: 'never write any' }),
});

describe('resolveStandards', () => {
	test('loads the package the plugin ships when the consumer specifies nothing', async () => {
		const { cwd } = setupRepo();

		const resolved = await resolveStandards({ cwd, config: baseConfig, packages: [] });

		expect(resolved.standards).toContain('<!-- lightsout-defaults: code/');
		expect(resolved.testStandards).toContain('<!-- lightsout-defaults: tests/');
		// unspecified is a real request for the defaults, so the caller still announces it
		expect(resolved.requested).toBe(true);
	});

	test('loads nothing when standards packages are explicitly disabled', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: false };

		const resolved = await resolveStandards({ cwd, config, packages: [] });

		expect(resolved.standards).toBe(undefined);
		expect(resolved.testStandards).toBe(undefined);
		// nothing was asked for, so there is nothing to announce
		expect(resolved.requested).toBe(false);
	});

	test('assembles both sets from exactly the package the consumer declared', async () => {
		const { cwd } = setupRepo({ files: packageFiles({ at: 'standards/house', name: 'house' }) });
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/house'], standardsChannels: [] };

		const resolved = await resolveStandards({ cwd, config, packages: [] });

		// the declared package replaces the bundled default rather than stacking under it
		expect(resolved.standards).toBe("<!-- house: code/house-style -->\n# house code\n\nHow this house writes code.\n\nindent with tabs — the rule's prose.");
		expect(resolved.testStandards).toBe(
			"<!-- house: tests/house-tests -->\n# house tests\n\nHow this house writes tests.\n\none behaviour per test — the rule's prose.",
		);
	});

	test('several declared packages stack in config order, set by set', async () => {
		const { cwd } = setupRepo({
			files: { ...packageFiles({ at: 'standards/house', name: 'house' }), ...packageFiles({ at: 'standards/team', name: 'team' }) },
		});
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/team', 'standards/house'], standardsChannels: [] };

		const resolved = await resolveStandards({ cwd, config, packages: [] });

		// each package contributes its own documents, headed by the package that owns them
		expect(resolved.standards ?? '').toContain('<!-- team: code/house-style -->');
		expect(resolved.standards ?? '').toContain('<!-- house: code/house-style -->');
		expect((resolved.standards ?? '').indexOf('<!-- team:')).toBeLessThan((resolved.standards ?? '').indexOf('<!-- house:'));
	});

	test('a package carrying one set leaves the other set out of the stack rather than gapping it', async () => {
		const { cwd } = setupRepo({
			files: { ...packageFiles({ at: 'standards/house', name: 'house' }), ...codeOnlyPackageFiles({ at: 'standards/lint', name: 'lint' }) },
		});
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/house', 'standards/lint'], standardsChannels: [] };

		const resolved = await resolveStandards({ cwd, config, packages: [] });

		expect(resolved.standards ?? '').toContain('<!-- lint: code/lint-style -->');
		// the tests set is the one package that carries it, with no separator left where the other would have gone
		expect(resolved.testStandards).toBe(
			"<!-- house: tests/house-tests -->\n# house tests\n\nHow this house writes tests.\n\none behaviour per test — the rule's prose.",
		);
	});

	test('a set no loaded package carries is absent even though standards were asked for', async () => {
		const { cwd } = setupRepo({ files: codeOnlyPackageFiles({ at: 'standards/lint', name: 'lint' }) });
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/lint'], standardsChannels: [] };

		const resolved = await resolveStandards({ cwd, config, packages: [] });

		expect(resolved.standards ?? '').toContain('<!-- lint: code/lint-style -->');
		expect(resolved.testStandards).toBe(undefined);
		// a package did load, so the caller still announces standards
		expect(resolved.requested).toBe(true);
	});

	test('channel detection reads the packages folder the config names', async () => {
		const { cwd } = setupRepo({ files: { 'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }) } });
		const config: LightsoutConfig = { ...baseConfig, packagesDir: 'apps', standardsPackages: false };

		const resolved = await resolveStandards({ cwd, config, packages: ['web'] });

		// nothing sits under the default `packages/`, so a detected react proves the configured folder was read
		expect(resolved.channels).toStrictEqual(['react']);
		expect(resolved.configured).toBe(false);
	});

	test('an inactive channel keeps its document out of the assembled text', async () => {
		const { cwd } = setupRepo({ files: packageFiles({ at: 'standards/house', name: 'house' }) });
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/house'], standardsChannels: [] };

		const withoutReact = await resolveStandards({ cwd, config, packages: [] });
		const withReact = await resolveStandards({ cwd, config: { ...config, standardsChannels: ['react'] }, packages: [] });

		expect(withoutReact.standards ?? '').not.toContain('code/react-style');
		expect(withReact.standards ?? '').toContain('<!-- house: code/react-style -->');
	});

	test('a configured channel list replaces detection', async () => {
		const { cwd } = setupRepo({ files: { 'packages/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }) } });
		const config: LightsoutConfig = { ...baseConfig, standardsChannels: [] };

		const resolved = await resolveStandards({ cwd, config, packages: ['web'] });

		// react is present in the scope but the config said base only
		expect(resolved.channels).toStrictEqual([]);
		expect(resolved.configured).toBe(true);
	});

	test('channels are detected from the scoped packages when the config is silent', async () => {
		const { cwd } = setupRepo({ files: { 'packages/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }) } });

		const resolved = await resolveStandards({ cwd, config: baseConfig, packages: ['web'] });

		expect(resolved.channels).toStrictEqual(['react']);
		expect(resolved.configured).toBe(false);
	});

	test('a declared package that does not exist is a hard error rather than a silent skip', async () => {
		const { cwd } = setupRepo();
		const config: LightsoutConfig = { ...baseConfig, standardsPackages: ['standards/ghost'] };

		const error = await getRejectionError({ promise: resolveStandards({ cwd, config, packages: [] }) });

		expect(error.message).toContain('standards package root file not found');
	});
});
