import { expect, test } from '@jest/globals';
import { readPlanPackages } from '#src/pipeline/index.ts';

test('readPlanPackages parses the block-list form', () => {
	const plan = '---\npackages:\n  - backend-api\n  - "shared"\n---\n# Plan\n';

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['backend-api', 'shared']);
});

test('readPlanPackages parses the inline form', () => {
	const plan = "---\npackages: [backend-api, 'web']\n---\n# Plan\n";

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['backend-api', 'web']);
});

test('readPlanPackages returns undefined without front-matter, key, or entries', () => {
	expect(readPlanPackages({ planContent: '# Plan: no front-matter\n' })).toBe(undefined);
	expect(readPlanPackages({ planContent: '---\ntitle: x\n---\n# Plan\n' })).toBe(undefined);
	expect(readPlanPackages({ planContent: '---\npackages: []\n---\n# Plan\n' })).toBe(undefined);
});

test('readPlanPackages stops the block list at the first non-entry line', () => {
	const plan = '---\npackages:\n  - api\n  - web\ntitle: something\n  - too-late\n---\n# Plan\n';

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['api', 'web']);
});

test('readPlanPackages returns undefined for a packages key with no block entries', () => {
	expect(readPlanPackages({ planContent: '---\npackages:\ntitle: x\n---\n# Plan\n' })).toBe(undefined);
});

test('readPlanPackages parses CRLF front-matter', () => {
	const plan = '---\r\npackages:\r\n  - api\r\n---\r\n# Plan\r\n';

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['api']);
});

test('readPlanPackages drops empty entries from the inline form', () => {
	const plan = "---\npackages: [api, , 'web']\n---\n# Plan\n";

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['api', 'web']);
});
