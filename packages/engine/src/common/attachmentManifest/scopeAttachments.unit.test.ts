import { describe, expect, test } from '@jest/globals';
import { scopeAttachments } from '#src/common/attachmentManifest/scopeAttachments.ts';

const setupTicketAttachments = () => {
	const attachments = [
		{ id: 'att-1', title: '001-search--plan.md', url: 'https://tracker.example/att-1' },
		{ id: 'att-2', title: '001-search-basics--plan.md', url: 'https://tracker.example/att-2' },
		{ id: 'att-3', title: 'plan.md', url: 'https://tracker.example/att-3' },
		{ id: 'att-4', title: 'state.json', url: 'https://tracker.example/att-4' },
	];

	return { attachments };
};

describe('scopeAttachments', () => {
	test("scopeAttachments: keeps only titles under the plan's own prefix and strips it, never matching a longer plan id", () => {
		const { attachments } = setupTicketAttachments();

		const scoped = scopeAttachments({ attachments, prefix: '001-search' });

		expect(scoped).toStrictEqual([{ id: 'att-1', title: 'plan.md', url: 'https://tracker.example/att-1' }]);
	});

	test('scopeAttachments: answers every attachment unchanged when no prefix is given', () => {
		const { attachments } = setupTicketAttachments();

		const scoped = scopeAttachments({ attachments });

		expect(scoped).toStrictEqual([
			{ id: 'att-1', title: '001-search--plan.md', url: 'https://tracker.example/att-1' },
			{ id: 'att-2', title: '001-search-basics--plan.md', url: 'https://tracker.example/att-2' },
			{ id: 'att-3', title: 'plan.md', url: 'https://tracker.example/att-3' },
			{ id: 'att-4', title: 'state.json', url: 'https://tracker.example/att-4' },
		]);
	});
});
