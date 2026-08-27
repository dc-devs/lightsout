import { describe, expect, test } from '@jest/globals';
import { CommandCatalogEntry } from '#src/contracts/index.ts';

const setupEntry = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const row: Record<string, unknown> = {
		id: 'refactor',
		slash: '/refactor',
		cli: 'lightsout refactor',
		group: 'burn-down',
		summary: 'Burn down the repo’s standards findings.',
		whenToUse: 'Reach for it when there are more findings than anyone will fix by hand.',
		records: 'runs',
		...extra,
	};

	if (omit) {
		delete row[omit];
	}

	return { row };
};

describe('CommandCatalogEntry', () => {
	test('the five list fields default to empty, so an entry states only what it has', () => {
		const { row } = setupEntry();

		const parsed = CommandCatalogEntry.parse(row);

		expect(parsed).toEqual(expect.objectContaining({ invocations: [], flags: [], steps: [], related: [] }));
	});

	test('a skill-only command parses with no cli — /brainstorm has no command word behind it', () => {
		const { row } = setupEntry({ omit: 'cli' });

		const parsed = CommandCatalogEntry.parse(row);

		expect(parsed.cli).toBeUndefined();
	});

	test('id, group, summary, whenToUse and records are required — a card with any of them missing renders blank', () => {
		for (const field of ['id', 'group', 'summary', 'whenToUse', 'records']) {
			const { row } = setupEntry({ omit: field });

			expect(CommandCatalogEntry.safeParse(row).success).toBe(false);
		}
	});

	test('group and records are closed sets — a value outside them has no heading and no history shape', () => {
		for (const extra of [{ group: 'misc' }, { records: 'files' }]) {
			const { row } = setupEntry({ extra });

			expect(CommandCatalogEntry.safeParse(row).success).toBe(false);
		}
	});

	test('a flag defaults to optional, so only a row that says so renders bare on the usage line', () => {
		const { row } = setupEntry({ extra: { flags: [{ name: 'cwd', value: '<path>', meaning: 'Repository to work in.' }] } });

		const parsed = CommandCatalogEntry.parse(row);

		expect(parsed.flags[0]?.required).toBe(false);
	});

	test('a step defaults to writing nothing, so only a step that names files carries a saved list', () => {
		const { row } = setupEntry({ extra: { steps: [{ title: 'START THE RUN', actor: 'the engine', bullets: ['Create a run id'] }] } });

		const parsed = CommandCatalogEntry.parse(row);

		expect(parsed.steps[0]?.saved).toStrictEqual([]);
	});

	test('a step actor outside the three the graphic can draw is refused', () => {
		const { row } = setupEntry({ extra: { steps: [{ title: 'START', actor: 'the intern', bullets: [] }] } });

		expect(CommandCatalogEntry.safeParse(row).success).toBe(false);
	});

	test('a graphic needs all four of its fields — a half-stated graphic would render a spec build_graphic.py cannot draw', () => {
		const { row } = setupEntry({ extra: { graphic: { title: 'How /refactor works', subtitle: 'Twelve steps', banner: 'Measured.' } } });

		expect(CommandCatalogEntry.safeParse(row).success).toBe(false);
	});
});
