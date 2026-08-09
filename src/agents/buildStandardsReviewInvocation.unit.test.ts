import { expect, describe, test } from '@jest/globals';
import { buildStandardsReviewInvocation } from '@/agents';

const rule = ({ id, documentPath = 'code/architecture/folder-structure', prose }: { id: string; documentPath?: string; prose: string }) => ({
	id,
	documentPath,
	prose,
});

describe('buildStandardsReviewInvocation', () => {
	test('a rule’s prose is inlined whole — the argument is what the reviewer generalises from', () => {
		const prose = '## Keep common close\n\nPromote a helper only when two modules need it.\n\n- first bullet\n- second bullet';

		const { systemPrompt } = buildStandardsReviewInvocation({ rules: [rule({ id: 'common-placement', prose })], files: ['src/a.ts'] });

		// every line of it, not a summary of it
		expect(systemPrompt).toContain(prose);
	});

	test('each rule is named by its id, so a finding can point back at one', () => {
		const { systemPrompt } = buildStandardsReviewInvocation({
			rules: [rule({ id: 'common-placement', prose: 'the argument' })],
			files: ['src/a.ts'],
		});

		expect(systemPrompt).toContain('**Rule id: `common-placement`**');
	});

	test('rules are grouped under the document that states them', () => {
		const { systemPrompt } = buildStandardsReviewInvocation({
			rules: [
				rule({ id: 'first', documentPath: 'code/architecture/folder-structure', prose: 'one' }),
				rule({ id: 'second', documentPath: 'code/style-guide/patterns/functions', prose: 'two' }),
				rule({ id: 'third', documentPath: 'code/architecture/folder-structure', prose: 'three' }),
			],
			files: ['src/a.ts'],
		});

		const rules = systemPrompt.split('# Rules to review against')[1] ?? '';

		// two headings for three rules — the two folder-structure rules read together
		expect(rules.match(/^## .+$/gm)).toStrictEqual(['## code/architecture/folder-structure', '## code/style-guide/patterns/functions']);
		// including the one that arrived last, which joins its own document rather
		// than trailing off the end
		expect(rules.indexOf('**Rule id: `third`**')).toBeLessThan(rules.indexOf('## code/style-guide/patterns/functions'));
	});

	test('rules keep the order they were handed over within their document', () => {
		const { systemPrompt } = buildStandardsReviewInvocation({
			rules: [
				rule({ id: 'first', prose: 'one' }),
				rule({ id: 'second', prose: 'two' }),
				rule({ id: 'third', prose: 'three' }),
			],
			files: ['src/a.ts'],
		});

		// the caller decides what should be read first — the grouping must not reshuffle it
		expect(systemPrompt.match(/\*\*Rule id: `(\w+)`\*\*/g)).toStrictEqual([
			'**Rule id: `first`**',
			'**Rule id: `second`**',
			'**Rule id: `third`**',
		]);
	});

	test('the role prompt leads the system prompt and the rules follow it behind a horizontal rule', () => {
		const { systemPrompt } = buildStandardsReviewInvocation({
			rules: [rule({ id: 'common-placement', prose: 'the argument' })],
			files: ['src/a.ts'],
		});

		const sections = systemPrompt.split('\n\n---\n\n');

		// exactly two sections: who the reviewer is, then what they review against
		expect(sections.length).toBe(2);
		expect(sections[0].startsWith('# Role: Standards Reviewer')).toBe(true);
		expect(sections[1]).toBe('# Rules to review against\n\n## code/architecture/folder-structure\n\n**Rule id: `common-placement`**\n\nthe argument');
	});

	test('the system prompt is byte-identical across reviews that differ only in the files under review', () => {
		const rules = [rule({ id: 'common-placement', prose: 'the argument' })];

		const first = buildStandardsReviewInvocation({ rules, files: ['src/a.ts'] });
		const second = buildStandardsReviewInvocation({ rules, files: ['src/b.ts', 'src/c.ts'] });

		// the whole reason the rules ride the system prompt: the harness caches through it
		expect(first.systemPrompt).toBe(second.systemPrompt);
	});

	test('the files are listed in the task message, which is the only half that changes between reviews', () => {
		const { systemPrompt, prompt } = buildStandardsReviewInvocation({
			rules: [rule({ id: 'common-placement', prose: 'the argument' })],
			files: ['src/a.ts', 'src/b/c.ts'],
		});

		expect(prompt).toContain('# Files in scope for the standards review');
		expect(prompt).toContain('- src/a.ts');
		expect(prompt).toContain('- src/b/c.ts');
		// the rules ride the cached half instead
		expect(systemPrompt.includes('src/a.ts')).toBe(false);
	});

	test('the role prompt and the JSON-only reminder both ride along', () => {
		const { systemPrompt, prompt } = buildStandardsReviewInvocation({
			rules: [rule({ id: 'common-placement', prose: 'the argument' })],
			files: ['src/a.ts'],
		});

		expect(systemPrompt).toContain('# Role: Standards Reviewer');
		expect(prompt).toContain('your entire final message must be exactly one JSON report object');
	});
});
