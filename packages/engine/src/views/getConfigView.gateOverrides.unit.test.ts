import { describe, expect, test } from '@jest/globals';
import type { ConfigView } from '#src/contracts/index.ts';
import { getConfigView } from '#src/views/index.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

/** One row out of the grouped sections, by the key the file would spell. */
const findField = ({ sections, key }: { sections: ConfigView['sections']; key: string }) =>
	sections.flatMap((section) => section.fields).find((field) => field.key === key);

/**
 * A block holding one checkpoint of each shape the schema allows — a list, and
 * the `"off"` spelling — so what the page reads back is both value shapes and
 * not just the one that is easy to render.
 */
const gateOverridesBlock = {
	'verify-implement': ['check', 'test'],
	'verify-refactor': 'off',
};

/** A repo whose config either writes the override block or deliberately omits it. */
const setupGateOverrides = async ({ overrides }: { overrides?: Record<string, unknown> } = {}) => {
	const cwd = await seedConfiguredCwd({ config: { ...(overrides !== undefined && { 'gate-overrides': overrides }) } });

	return { cwd };
};

describe('getConfigView', () => {
	test('carries a gate-overrides block the file wrote onto the page, both shapes of a checkpoint value intact', async () => {
		const { cwd } = await setupGateOverrides({ overrides: gateOverridesBlock });

		const view = await getConfigView({ cwd });

		// the block travels whole: a checkpoint written as a list and one written as
		// "off" are different schedules, so dropping either would be a lie about
		// what this repo asked for
		expect(findField({ sections: view.sections, key: 'gate-overrides' })).toEqual(
			expect.objectContaining({ value: { 'verify-implement': ['check', 'test'], 'verify-refactor': 'off' }, fromConfig: true }),
		);
	});

	test('leaves gate-overrides null when the file omits it, because every checkpoint then keeps the engine’s own schedule', async () => {
		const { cwd } = await setupGateOverrides();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'gate-overrides' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('keeps gate-overrides in the Gates area, after the two gate blocks whose schedule it replaces', async () => {
		const { cwd } = await setupGateOverrides({ overrides: gateOverridesBlock });

		const view = await getConfigView({ cwd });

		expect(view.sections.find((section) => section.title === 'Gates')?.fields.map((field) => field.key)).toStrictEqual([
			'gates',
			'package-gates',
			'gate-overrides',
			'packages-dir',
			'coverage-summary-path',
			'executor-file-limit',
		]);
	});

	test('states on the gate-overrides row which checkpoints it keys and what an unlisted one does', async () => {
		const { cwd } = await setupGateOverrides({ overrides: gateOverridesBlock });

		const view = await getConfigView({ cwd });

		// the sentence is the one the config reference document is rendered from,
		// so the page and that document cannot say different things about the key
		const description = findField({ sections: view.sections, key: 'gate-overrides' })?.description ?? '';

		expect(description).toEqual(expect.stringContaining('clean-slate'));
		expect(description).toEqual(expect.stringContaining('verify-refactor'));
	});
});
