import { describe, expect, test } from '@jest/globals';
import { rewritePlanSection } from '#src/plan/sections/index.ts';

describe('rewritePlanSection', () => {
	test('replaces a real section while preserving identically named headings in fenced prose', () => {
		const content =
			'# Plan\n\n## Context\n\n~~~md\n## Acceptance Tests\nkeep this example\n~~~\n\n## Acceptance Tests\n\nold\n\n## Verification\n\nkeep this verification\n';

		const rewritten = rewritePlanSection({ content, base: 'plan.md', heading: 'Acceptance Tests', section: '## Acceptance Tests\n\nnew exact ledger' });

		expect(rewritten).toBe(content.replace('## Acceptance Tests\n\nold', '## Acceptance Tests\n\nnew exact ledger'));
	});

	test.each([
		{ content: '# Plan', expected: '# Plan\n\n## Context\n\nnew' },
		{ content: '# Plan\n', expected: '# Plan\n\n## Context\n\nnew\n' },
	])('preserves the file ending when appending to $content', ({ content, expected }) => {
		const rewritten = rewritePlanSection({ content, base: 'plan.md', heading: 'Context', section: '## Context\n\nnew', after: 'Missing' });

		expect(rewritten).toBe(expected);
	});

	test('inserts immediately after an existing anchor without moving later sections', () => {
		const content = '# Plan\n\n## Context\n\nkeep\n\n## Verification\n\ncheck\n';

		const rewritten = rewritePlanSection({
			content,
			base: 'plan.md',
			heading: 'Global Constraints',
			section: '## Global Constraints\n\nretained obligations',
			after: 'Context',
		});

		expect(rewritten).toBe('# Plan\n\n## Context\n\nkeep\n\n## Global Constraints\n\nretained obligations\n\n## Verification\n\ncheck\n');
	});

	test.each([{ content: '# Plan\n## Context\nfirst\n## Context\nsecond' }, { content: '# Plan\n## Context\n```md\nunclosed' }])(
		'refuses ambiguous input without discarding any authored text: $content',
		({ content }) => {
			const rewrite = () => rewritePlanSection({ content, base: 'plan.md', heading: 'Context', section: '## Context\nnew' });

			expect(rewrite).toThrow(/Ambiguous planning sections/);
		},
	);
});
