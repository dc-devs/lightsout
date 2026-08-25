import { describe, expect, test } from '@jest/globals';
import { setupFileListInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

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
				// junk drawers by name, banned at every level
				'src/tier/helpers/a.ts',
				'src/tier/lib/b.ts',
				'src/tier/core/c.ts',
				'src/tier/misc/d.ts',
				'src/tier/shared/e.ts',
				// kind-buckets whose sanctioned home is common/
				'src/tier/utils/j.ts',
				'src/tier/types/L.ts',
				'src/tier/constants/m.ts',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'path-banned-module-name:src/tier/constants',
			'path-banned-module-name:src/tier/core',
			'path-banned-module-name:src/tier/helpers',
			'path-banned-module-name:src/tier/lib',
			'path-banned-module-name:src/tier/misc',
			'path-banned-module-name:src/tier/shared',
			'path-banned-module-name:src/tier/types',
			'path-banned-module-name:src/tier/utils',
		]);
	});

	test('framework vocabulary is legal with no framework declared — the un-banning layer is gone', async () => {
		const input = setupFileListInput({
			files: [
				'src/feature/components/Card.tsx',
				'src/feature/hooks/useCard.ts',
				'src/api/controllers/user.ts',
				'src/api/models/user.ts',
				'src/api/services/mailer.ts',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a package declaring frameworks keeps every banned name banned, since no framework in the table mandates one', async () => {
		const input = setupFileListInput({
			files: [
				'packages/web/src/feature/components/Card.tsx',
				'packages/web/src/feature/hooks/useCard.ts',
				'packages/web/src/feature/helpers/format.ts',
				'packages/api/src/user/services/mailer.ts',
				'packages/api/src/user/utils/format.ts',
			],
			dependencies: [
				['packages/web', ['react', 'react-dom', '@tanstack/react-router']],
				['packages/api', ['@nestjs/core']],
			],
		});

		const findings = await check.run({ input, settings: {} });

		// the framework vocabulary stays legal because it is off the banned list,
		// not because a declared dependency un-bans it
		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'path-banned-module-name:packages/api/src/user/utils',
			'path-banned-module-name:packages/web/src/feature/helpers',
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

	test('still bans a junk-drawer folder under a common/, since those five are wrong at every level', async () => {
		const input = setupFileListInput({ files: ['src/mod/common/helpers/n.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-banned-module-name:src/mod/common/helpers']);
	});

	test("judges only paths inside a package's source tree, never the repo's own test and script trees", async () => {
		const input = setupFileListInput({ files: ['src/helpers/a.ts', 'tests/helpers/b.ts', 'scripts/lib/c.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-banned-module-name:src/helpers']);
	});

	test('anchors per package: each workspace package is judged inside its own src/', async () => {
		const input = setupFileListInput({
			files: ['packages/api/src/billing/helpers/a.ts', 'packages/api/tests/helpers/b.ts'],
			dependencies: [['packages/api', []]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['path-banned-module-name:packages/api/src/billing/helpers']);
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
