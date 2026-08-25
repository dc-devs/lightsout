import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { getPackFrameworkFacts } from '#src/standardsPacks/index.ts';

const baseConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/**
 * A pack's answer written the way a pack author writes it: the dependency table
 * stays inside the pack, and only the question crosses to the engine. Scoped
 * per declaring package, because that is what the map's keys are for.
 */
const factsSource = [
	'export const getFrameworkFacts = ({ dependencies }) => ({',
	'\tisFrameworkLoadedFile: ({ path }) =>',
	'\t\t[...dependencies].some(([directory, names]) => {',
	"\t\t\tconst routerRoot = directory === '.' ? 'src/routes/' : `${directory}/src/routes/`;",
	'',
	"\t\t\treturn names.includes('@tanstack/react-router') && path.startsWith(routerRoot);",
	'\t\t}),',
	'});',
	'',
].join('\n');

/** The same module missing the export the engine calls — a pack declaring the surface it cannot supply. */
const brokenFactsSource = 'export const getFacts = () => ({ isFrameworkLoadedFile: () => false });\n';

/** A temp consumer repo, optionally holding a miniature pack under `pack/` and a workspace package of its own. */
const setupRepo = ({ frameworks, workspace }: { frameworks?: 'facts' | 'broken'; workspace?: { packagesDir: string } } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-pack-facts-'));
	const packagesDir = workspace?.packagesDir ?? 'packages';
	const files: Record<string, string> = {
		'package.json': '{ "name": "consumer", "dependencies": { "@tanstack/react-router": "1.0.0" } }\n',
		'pack/lightsout-standards.json': '{ "name": "acme", "formatVersion": 1 }\n',
		'pack/code/demo/document.md': '# Demo\n\nThe document the rule argues under.\n',
		'pack/code/demo/01-example/rule.md': '---\nsummary: a rule the pack declares\n---\n\nThe rule prose.\n',
		'pack/code/demo/01-example/fixtures/pass/src/example.ts': 'export const example = 1;\n',
		'pack/code/demo/01-example/fixtures/fail/src/example.ts': 'export const example = 2;\n',
		...(frameworks === 'facts' ? { 'pack/common/frameworks/getFrameworkFacts.ts': factsSource } : {}),
		...(frameworks === 'broken' ? { 'pack/common/frameworks/getFrameworkFacts.ts': brokenFactsSource } : {}),
	};

	if (workspace !== undefined) {
		files[`${packagesDir}/web/package.json`] = '{ "name": "web", "dependencies": { "@tanstack/react-router": "1.0.0" } }\n';
		files[`${packagesDir}/api/package.json`] = '{ "name": "api", "dependencies": { "@nestjs/core": "11.0.0" } }\n';
	}

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(cwd, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	const config: LightsoutConfig = { ...baseConfig, 'standards-packs': ['pack'] };

	return { cwd, config, packagesDir };
};

describe('getPackFrameworkFacts', () => {
	test('the repo’s configured pack answers, reading the repo’s own manifests', async () => {
		const { cwd, config } = setupRepo({ frameworks: 'facts' });

		const facts = await getPackFrameworkFacts({ cwd, packagesDir: 'packages', config });

		expect(facts.isFrameworkLoadedFile({ path: 'src/routes/index.tsx' })).toBe(true);
		expect(facts.isFrameworkLoadedFile({ path: 'src/features/app.tsx' })).toBe(false);
	});

	test('a pack shipping no framework facts is the supported silent case', async () => {
		const { cwd, config } = setupRepo();

		const facts = await getPackFrameworkFacts({ cwd, packagesDir: 'packages', config });

		// the mirrors go on knowing nothing, exactly as they did before this surface
		expect(facts.isFrameworkLoadedFile({ path: 'src/routes/index.tsx' })).toBe(false);
	});

	test('a repo that asked for no packs at all is answered by none of them', async () => {
		const { cwd } = setupRepo({ frameworks: 'facts' });

		const facts = await getPackFrameworkFacts({ cwd, packagesDir: 'packages', config: { ...baseConfig, 'standards-packs': false } });

		expect(facts.isFrameworkLoadedFile({ path: 'src/routes/index.tsx' })).toBe(false);
	});

	test('a workspace package’s own declaration governs its own src, read from the package parent dir the run names', async () => {
		const { cwd, config, packagesDir } = setupRepo({ frameworks: 'facts', workspace: { packagesDir: 'modules' } });

		const facts = await getPackFrameworkFacts({ cwd, packagesDir, config });

		// the manifests reach the pack keyed by package, so the package that
		// declared the router is the only one whose routes are framework-loaded —
		// and a repo keeping its packages under another name is still read
		expect(facts.isFrameworkLoadedFile({ path: 'modules/web/src/routes/index.tsx' })).toBe(true);
		expect(facts.isFrameworkLoadedFile({ path: 'modules/api/src/routes/index.tsx' })).toBe(false);
	});

	test('a pack declaring the module it cannot supply fails the run rather than answering half-informed', async () => {
		const { cwd, config } = setupRepo({ frameworks: 'broken' });

		// a mirror told "nothing is framework-loaded" by a broken pack would map
		// boundaries the rules do not — the silent case belongs to a pack that
		// ships no module at all
		await expect(getPackFrameworkFacts({ cwd, packagesDir: 'packages', config })).rejects.toThrow('must export `getFrameworkFacts`');
	});
});
