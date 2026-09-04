import { describe, expect, test } from '@jest/globals';
import type { ConfigView } from '#src/contracts/index.ts';
import { getConfigView } from '#src/views/index.ts';
import { generatedPaths } from '#tests/helpers/generatedPaths.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

/** One row out of the grouped sections, by the key the file would spell. */
const findField = ({ sections, key }: { sections: ConfigView['sections']; key: string }) =>
	sections.flatMap((section) => section.fields).find((field) => field.key === key);

/** The shape of a vendored entry: a folder of third-party components the repo pulled in rather than wrote. */
const vendoredPaths = ['packages/web-app/src/common/components/ui'];

/** A repo whose config names the paths it generates, the paths it vendors, both, or neither. */
const setupGeneratedConfig = async ({ generated, vendored }: { generated?: string[]; vendored?: string[] } = {}) => {
	const cwd = await seedConfiguredCwd({ config: { ...(generated !== undefined && { generated }), ...(vendored !== undefined && { vendored }) } });

	return { cwd };
};

describe('getConfigView', () => {
	test('carries the generated paths a repo declared, a directory prefix and a single file alike', async () => {
		const { cwd } = await setupGeneratedConfig({ generated: generatedPaths });

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'generated' })).toEqual(
			expect.objectContaining({ value: ['plugin/dist/', 'packages/web-app/src/routeTree.gen.ts'], fromConfig: true }),
		);
	});

	test('leaves generated null when the file names none, which is the row that reads "default: none"', async () => {
		const { cwd } = await setupGeneratedConfig();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'generated' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('keeps vendored a row of its own, because the two lists answer different questions about a changed file', async () => {
		const { cwd } = await setupGeneratedConfig({ generated: generatedPaths, vendored: vendoredPaths });

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'vendored' })).toEqual(
			expect.objectContaining({ value: ['packages/web-app/src/common/components/ui'], fromConfig: true }),
		);
	});

	test('states on the generated row that a worker commit never carries these paths, and does not state it of vendored', async () => {
		const { cwd } = await setupGeneratedConfig({ generated: generatedPaths, vendored: vendoredPaths });

		const view = await getConfigView({ cwd });

		// the sentence is the one the config reference document is rendered from,
		// so the page and that document cannot say different things about the key —
		// and a vendored edit is the worker's own change, which a worker still commits
		expect(findField({ sections: view.sections, key: 'generated' })?.description).toEqual(expect.stringContaining('pre-ship step at merge time'));
		expect(findField({ sections: view.sections, key: 'vendored' })?.description).toEqual(expect.not.stringContaining('pre-ship'));
	});

	test('puts generated and vendored together in the Generated area, in the order the page reads them', async () => {
		const { cwd } = await setupGeneratedConfig({ generated: generatedPaths, vendored: vendoredPaths });

		const view = await getConfigView({ cwd });

		expect(view.sections.find((section) => section.title === 'Generated')?.fields.map((field) => field.key)).toStrictEqual(['generated', 'vendored']);
	});
});
