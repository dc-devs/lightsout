import { describe, expect, test } from '@jest/globals';
import { parsePlan } from '@/plan/parsePlan';

const parse = ({ content, base = 'demo.md' }: { content: string; base?: string }) => parsePlan({ content, base });

describe('parsePlan', () => {
	test('reads the title from the first level-one heading', () => {
		expect(parse({ content: '# Add search\n\nbody\n' }).title).toBe('Add search');
	});

	test('a plan with no heading has an empty title rather than an invented one', () => {
		// the structural lint reports the missing heading; the parser does not
		// guess a title from the filename to paper over it
		expect(parse({ content: 'just some prose\n' }).title).toBe('');
	});

	test('splits the body into its level-two sections, keeping subheadings inside them', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Modify\n\n### `src/a.ts`\n\n## Verification\n\n- `pnpm check`\n' });

		expect([...plan.sections.keys()]).toStrictEqual(['Files to Modify', 'Verification']);
		expect(plan.sections.get('Files to Modify')).toContain('### `src/a.ts`');
	});

	test('collects the modify paths from the subheadings that name them', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Modify\n\n### `src/a.ts`\n\nwhy\n\n### `src/b.ts`\n' });

		expect(plan.modifyPaths).toStrictEqual(['src/a.ts', 'src/b.ts']);
	});

	test('collects the mirror paths from bullets, which is how that section is written', () => {
		const plan = parse({ content: '# Plan\n\n## Patterns to Mirror\n\n- `src/existing.ts` — follow this\n' });

		expect(plan.mirrorPaths).toStrictEqual(['src/existing.ts']);
	});

	test('a file named overview.md is an overview whatever its body says', () => {
		expect(parse({ content: '# Anything\n', base: 'overview.md' }).variant).toBe('overview');
	});

	test('a plan carrying both phase sections is an overview, wherever it lives', () => {
		const content = '# Plan\n\n## Phases\n\n- one\n\n## Cross-Phase Dependencies\n\n- none\n';

		expect(parse({ content }).variant).toBe('overview');
	});

	test('a title ending in Overview marks the variant too', () => {
		expect(parse({ content: '# Demo — Overview\n' }).variant).toBe('overview');
	});

	test('anything else is implementable, which is the variant that gets built', () => {
		expect(parse({ content: '# Add search\n\n## Files to Modify\n' }).variant).toBe('implementable');
	});

	test('sections before the first heading are not attributed to a section', () => {
		const plan = parse({ content: 'stray line\n\n## Verification\n\n- `pnpm check`\n' });

		expect([...plan.sections.keys()]).toStrictEqual(['Verification']);
	});

	test('a modify subheading with no code span contributes no path', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Modify\n\n### General cleanup\n\n### `src/a.ts`\n' });

		// a prose subheading names no file; guessing one would send an agent at nothing
		expect(plan.modifyPaths).toStrictEqual(['src/a.ts']);
	});

	test('a verification bullet with no code span contributes no command', () => {
		const plan = parse({ content: '# Plan\n\n## Verification\n\n- run the tests somehow\n- `pnpm check`\n' });

		expect(plan.verificationCommands).toStrictEqual(['pnpm check']);
	});
});
