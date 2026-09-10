import { describe, expect, test } from '@jest/globals';
import { toBranchFileName } from '#src/common/utils/toBranchFileName.ts';

describe('toBranchFileName', () => {
	test('replaces every character outside the safe set with a dash, so one branch keys one file', () => {
		const fileName = toBranchFileName({ branch: 'feature/LO-42 fix (v1.0_final)' });

		expect(fileName).toBe('feature-LO-42-fix--v1.0_final-');
	});
});
