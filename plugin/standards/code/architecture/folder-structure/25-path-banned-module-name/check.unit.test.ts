import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a path rule: every file in scope, plus each package's declared dependencies. */
const setupFileListInput = ({
	files,
	dependencies = [],
}: {
	files: string[];
	dependencies?: Array<[string, string[]]>;
}): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files,
	tests: [],
	files,
	referenceFiles: [],
	dependencies: new Map(dependencies),
});

/** The input a rule that did NOT declare `file-list` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/billing/helpers/formatAmount.ts'],
	spans: [],
});

describe('path-banned-module-name check', () => {
	test('asks for the file list alone, since a folder name is read from its path', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports a folder named for the role of the code it holds', async () => {
		const input = setupFileListInput({ files: ['src/billing/helpers/formatAmount.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'path-banned-module-name:src/billing/helpers',
				files: [{ path: 'src/billing/helpers' }],
				detail: "folder 'helpers' names the role of the code it holds",
				guidance:
					'Name the folder for the domain it serves, or fold its files into the module that owns them — the only privileged folder name at any level is `common/`.',
			},
		]);
	});

	test('names every folder on the closed list, restated here so a name dropped from it stops enforcing loudly', async () => {
		const input = setupFileListInput({
			files: [
				// banned at every level: a folder named for the role of its code
				'src/tier/helpers/a.ts',
				'src/tier/lib/b.ts',
				'src/tier/core/c.ts',
				'src/tier/misc/d.ts',
				'src/tier/shared/e.ts',
				'src/tier/controllers/f.ts',
				'src/tier/models/g.ts',
				'src/tier/hooks/h.ts',
				'src/tier/components/i.ts',
				// banned only outside common/, where these four are the mandated skeleton
				'src/tier/utils/j.ts',
				'src/tier/services/k.ts',
				'src/tier/types/L.ts',
				'src/tier/constants/m.ts',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'path-banned-module-name:src/tier/components',
			'path-banned-module-name:src/tier/constants',
			'path-banned-module-name:src/tier/controllers',
			'path-banned-module-name:src/tier/core',
			'path-banned-module-name:src/tier/helpers',
			'path-banned-module-name:src/tier/hooks',
			'path-banned-module-name:src/tier/lib',
			'path-banned-module-name:src/tier/misc',
			'path-banned-module-name:src/tier/models',
			'path-banned-module-name:src/tier/services',
			'path-banned-module-name:src/tier/shared',
			'path-banned-module-name:src/tier/types',
			'path-banned-module-name:src/tier/utils',
		]);
	});

	test('leaves the four type folders alone inside a common/, which is their own mandated vocabulary', async () => {
		const input = setupFileListInput({
			files: [
				'src/mod/common/utils/n.ts',
				'src/mod/common/services/o.ts',
				'src/mod/common/types/P.ts',
				'src/mod/common/constants/q.ts',
				// a type folder under a graduated domain folder is still below a common/
				'src/mod/common/parsing/utils/r.ts',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('still bans a role-named folder under a common/, since those nine are wrong at every level', async () => {
		const input = setupFileListInput({ files: ['src/mod/common/helpers/n.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-banned-module-name:src/mod/common/helpers']);
	});

	test("judges only paths inside a package's source tree, never the repo's own test and script trees", async () => {
		const input = setupFileListInput({ files: ['src/helpers/a.ts', 'tests/helpers/b.ts', 'scripts/lib/c.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-banned-module-name:src/helpers']);
	});

	test("honours each package's own framework carve-out rather than the repo-wide union", async () => {
		const input = setupFileListInput({
			files: [
				// React mandates a feature's own components/, and mandates nothing about controllers/
				'src/feature/components/Card.tsx',
				'src/feature/controllers/user.ts',
				// NestJS mandates controllers/, and mandates nothing about components/
				'packages/api/src/controllers/user.controller.ts',
				'packages/api/src/components/Card.tsx',
			],
			dependencies: [
				['.', ['react']],
				['packages/api', ['@nestjs/core']],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'path-banned-module-name:packages/api/src/components',
			'path-banned-module-name:src/feature/controllers',
		]);
	});

	test('reports each banned folder once however many files it holds, in path order', async () => {
		const input = setupFileListInput({ files: ['src/b/lib/one.ts', 'src/b/lib/two.ts', 'src/a/core/three.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-banned-module-name:src/a/core', 'path-banned-module-name:src/b/lib']);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
