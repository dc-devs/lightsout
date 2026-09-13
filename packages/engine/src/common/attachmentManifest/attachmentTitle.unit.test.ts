import { describe, expect, test } from '@jest/globals';
import { attachmentTitle } from '#src/common/attachmentManifest/attachmentTitle.ts';

const setupPlanFile = () => ({ prefix: '002-fix', name: 'plan.md' });

describe('attachmentTitle', () => {
	test('attachmentTitle: joins the prefix and the file name with a double hyphen, and answers the bare name with no prefix', () => {
		const { prefix, name } = setupPlanFile();

		const titles = [attachmentTitle({ prefix, name }), attachmentTitle({ name })];

		expect(titles).toStrictEqual(['002-fix--plan.md', 'plan.md']);
	});
});
