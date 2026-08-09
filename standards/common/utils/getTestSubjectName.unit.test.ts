import { expect, describe, test } from '@jest/globals';
import { getTestSubjectName } from './getTestSubjectName.ts';

describe('getTestSubjectName', () => {
	test('names the subject a test sits beside — everything before the first dot', () => {
		expect(getTestSubjectName({ test: 'src/common/utils/formatRate.unit.test.ts' })).toBe('formatRate');
	});

	test('drops a qualifier as readily as the suffix, since both follow the first dot', () => {
		expect(getTestSubjectName({ test: 'src/pipeline/runPipeline.monorepo.unit.test.ts' })).toBe('runPipeline');
	});

	test('reads the filename alone, not the folders above it', () => {
		expect(getTestSubjectName({ test: 'src/a.b.c/formatRate.spec.tsx' })).toBe('formatRate');
	});

	test('a name with no dot at all is the whole filename', () => {
		expect(getTestSubjectName({ test: 'src/common/utils/formatRate' })).toBe('formatRate');
	});
});
