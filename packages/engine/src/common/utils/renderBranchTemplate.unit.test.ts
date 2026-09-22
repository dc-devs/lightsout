import { describe, expect, test } from '@jest/globals';
import { renderBranchTemplate } from '#src/common/utils/renderBranchTemplate.ts';

describe('renderBranchTemplate', () => {
	test('renderBranchTemplate: with no reference the ticket token and the separator beside it drop, at either end of the template', () => {
		const leadingToken = renderBranchTemplate({ template: '{ticket}-{slug}', title: 'Add search basics' });
		const trailingToken = renderBranchTemplate({ template: '{slug}-{ticket}', title: 'Add search basics' });

		expect({ leadingToken, trailingToken }).toStrictEqual({
			leadingToken: 'add-search-basics',
			trailingToken: 'add-search-basics',
		});
	});

	test("renderBranchTemplate: a token with a separator on both sides drops the one after it, keeping the prefix's slash", () => {
		const branch = renderBranchTemplate({ template: 'feature/{ticket}-{slug}', title: 'Add search basics' });

		expect(branch).toBe('feature/add-search-basics');
	});

	test('renderBranchTemplate: renders the lowercased reference and the slugged title, leaving an unknown token as written', () => {
		const branch = renderBranchTemplate({
			template: '{ticket}-{slug}-{author}',
			ticketRef: 'LO-158',
			title: 'Give the name one author',
		});

		expect(branch).toBe('lo-158-give-the-name-one-author-{author}');
	});
});
