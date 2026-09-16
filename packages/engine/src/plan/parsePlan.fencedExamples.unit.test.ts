import { describe, expect, test } from '@jest/globals';
import { parsePlan } from '#src/plan/index.ts';

const setup = ({ open, close }: { open: string; close: string }) => {
	const lines = [
		'# Real plan',
		'## Context',
		open,
		'# False overview — Overview',
		'## Acceptance Tests',
		'| false | `src/false.unit.test.ts` | false test | test |',
		'## Files to Create',
		'### `src/false.ts`',
		close,
		'## Files to Create',
		'### `src/real.ts`',
		'## Acceptance Tests',
		'| real | `src/real.unit.test.ts` | real test | test |',
	];
	return { content: lines.join('\n'), lines };
};

describe('parsePlan', () => {
	test.each([
		{ open: '```md', close: '```' },
		{ open: '~~~ markdown', close: '~~~~' },
		{ open: '   ````md', close: '   `````' },
	])('preserves $open examples without treating their headings or paths as declarations', ({ open, close }) => {
		const input = setup({ open, close });

		const plan = parsePlan({ content: input.content, base: 'plan.md' });

		expect(plan.title).toBe('Real plan');
		expect(plan.variant).toBe('implementable');
		expect(plan.createPaths).toEqual(['src/real.ts']);
		expect(plan.ledger).toEqual([{ criterion: 'real', testFile: 'src/real.unit.test.ts', testName: 'real test', gate: 'test', line: 13 }]);
		expect(plan.lines).toEqual(input.lines);
		expect(plan.sections.get('Context')).toContain('## Acceptance Tests');
		expect(plan.duplicateSections).toBeUndefined();
		expect(plan.unterminatedFence).toBeUndefined();
	});

	test.each([
		{ open: '````md', close: '```' },
		{ open: '~~~', close: '```' },
		{ open: '```', close: '``` trailing text' },
	])('reports an unclosed $open fence rather than accepting an invalid $close closer', ({ open, close }) => {
		const input = setup({ open, close });

		const plan = parsePlan({ content: input.content, base: 'plan.md' });

		expect(plan.unterminatedFence).toBe(true);
		expect(plan.createPaths).toEqual([]);
		expect(plan.ledger).toEqual([]);
		expect(plan.lines).toEqual(input.lines);
	});

	test('treats backticks in a backtick fence info string as ordinary prose and reports real duplicate sections', () => {
		const content = '# Plan\n## Context\n```not`a`fence\n## Verification\n- `pnpm test`\n## Verification\n- `pnpm check`';

		const plan = parsePlan({ content, base: 'plan.md' });

		expect(plan.duplicateSections).toEqual(['Verification']);
		expect(plan.unterminatedFence).toBeUndefined();
		expect(plan.verificationCommands).toEqual(['pnpm check']);
		expect(plan.lines.join('\n')).toBe(content);
	});
});
