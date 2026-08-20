import { describe, expect, test } from '@jest/globals';
import { cn } from '#src/common/utils/cn.ts';

describe('cn', () => {
	test('joins the class names it is given', () => {
		const merged = cn('rounded-md', 'px-2');

		expect(merged).toBe('rounded-md px-2');
	});

	test('drops a falsy entry rather than printing it', () => {
		const merged = cn('rounded-md', false && 'hidden', undefined, ['px-2']);

		expect(merged).toBe('rounded-md px-2');
	});

	test('lets a later Tailwind utility win over an earlier one in the same group', () => {
		const merged = cn('px-2', 'px-4');

		expect(merged).toBe('px-4');
	});
});
