import { describe, expect, test } from '@jest/globals';
import { type PhaseDeclaration, parsePhaseDeclarations, parsePlan } from '#src/plan/index.ts';
import { renderPhaseSections } from '#src/plan/sections/index.ts';

const setup = (): PhaseDeclaration[] => [
	{
		number: 1,
		file: 'phase9-original.md',
		scope: ' Preserve | &amp; `identity`\r\nordering ',
		createdCount: 1,
		touchedCount: 2,
		creates: ['src/upload.ts'],
		exports: ['upload'],
		scripts: ['test:upload'],
		fileBudget: 5,
	},
	{
		number: 2,
		file: 'phase2-unrelated.md',
		scope: 'Unrelated work',
		createdCount: 0,
		touchedCount: 0,
		creates: [],
		exports: [],
		scripts: [],
	},
];

describe('renderPhaseSections', () => {
	test('keeps exact scope text and declaration metadata in one shared ordered view', () => {
		const declarations = setup();

		const sections = renderPhaseSections({ declarations, lossless: true });
		const parsed = parsePhaseDeclarations({ plan: parsePlan({ content: `# Overview\n\n${[...sections.values()].join('\n\n')}`, base: 'overview.md' }) });

		expect(parsed).toEqual(declarations);
		expect([...sections.keys()]).toEqual(['Phases', 'Phase Declarations']);
		expect(sections.get('Phases')).toContain('&#124; &amp;amp; &#96;identity&#96;&#13;&#10;');
		expect(sections.get('Phase Declarations')).toContain('test:upload');
	});

	test('renders an explicit empty phase collection without inventing a declaration', () => {
		const sections = renderPhaseSections({ declarations: [], lossless: true });

		expect(sections.get('Phases')).toContain('| # | File | Scope | Creates | Touches |');
		expect(sections.get('Phase Declarations')).not.toContain('### Phase');
		expect([...sections.keys()]).toEqual(['Phases', 'Phase Declarations']);
	});
});

const setupExactDeclaration = (): PhaseDeclaration => ({
	number: 1,
	file: 'phase1-`literal` &amp; \tname.md\t',
	scope: '\u00a0Keep\u2028every\u2029boundary\ufeff',
	creates: [' src/`part`|&amp;.ts\t'],
	exports: ['\ufeffliteral`name'],
	scripts: ['\tcheck:exact|&#9;\u00a0'],
});

test('renderPhaseSections preserves exact encoded filenames and declaration values without decoding twice', () => {
	const declaration = setupExactDeclaration();

	const sections = renderPhaseSections({ declarations: [declaration], lossless: true });
	const plan = parsePlan({ content: `# Overview\n\n${[...sections.values()].join('\n\n')}`, base: 'overview.md' });
	const parsed = parsePhaseDeclarations({ plan });

	expect(parsed).toEqual([declaration]);
	expect(plan.duplicateSections).toBeUndefined();
});

test('renderPhaseSections retains literal legacy declaration entities', () => {
	const declaration = { ...setup()[0], creates: ['src/literal&#9;.ts'], exports: ['literal&amp;'], scripts: ['check:&#32;'] };
	const sections = renderPhaseSections({ declarations: [declaration] });
	const parsed = parsePhaseDeclarations({ plan: parsePlan({ content: [...sections.values()].join('\n\n'), base: 'overview.md' }) });
	expect(parsed[0]).toEqual(expect.objectContaining({ creates: ['src/literal&#9;.ts'], exports: ['literal&amp;'], scripts: ['check:&#32;'] }));
});
