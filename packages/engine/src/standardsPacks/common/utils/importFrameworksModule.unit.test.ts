import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { importFrameworksModule } from '#src/standardsPacks/common/utils/importFrameworksModule.ts';

/** A temp pack shipping one framework-facts module, written the way a pack author writes one. */
const setupModule = ({ source, name }: { source: string; name: string }) => {
	const packPath = mkdtempSync(join(tmpdir(), 'lightsout-frameworks-'));
	const modulePath = join(packPath, 'common', 'frameworks', `${name}.ts`);

	mkdirSync(dirname(modulePath), { recursive: true });
	writeFileSync(modulePath, source);

	return { modulePath };
};

/** A pack's answer, reduced to what this test can observe: routes are loaded, and only where a dependency was declared. */
const factsSource = [
	'export const getFrameworkFacts = ({ dependencies }) => ({',
	"\tisFrameworkLoadedFile: ({ path }) => dependencies.size > 0 && path.startsWith('src/routes/'),",
	'});',
	'',
].join('\n');

describe('importFrameworksModule', () => {
	test('hands back the very function the pack exported, which the engine then calls', async () => {
		const { modulePath } = setupModule({ name: 'getFrameworkFacts', source: factsSource });

		const { getFrameworkFacts } = await importFrameworksModule({ modulePath });
		const facts = getFrameworkFacts({ dependencies: new Map([['.', ['@tanstack/react-router']]]) });

		expect(facts.isFrameworkLoadedFile({ path: 'src/routes/index.tsx' })).toBe(true);
		expect(facts.isFrameworkLoadedFile({ path: 'src/features/app.tsx' })).toBe(false);
	});

	test('names the file when the pack ships the module without the export', async () => {
		const { modulePath } = setupModule({ name: 'missingExport', source: 'export const getFacts = () => ({ isFrameworkLoadedFile: () => false });\n' });

		await expect(importFrameworksModule({ modulePath })).rejects.toThrow(modulePath);
	});

	test('rejects an export that is not callable, at load rather than deep inside a run', async () => {
		const { modulePath } = setupModule({ name: 'notAFunction', source: 'export const getFrameworkFacts = { isFrameworkLoadedFile: false };\n' });

		await expect(importFrameworksModule({ modulePath })).rejects.toThrow('must export `getFrameworkFacts`');
	});
});
