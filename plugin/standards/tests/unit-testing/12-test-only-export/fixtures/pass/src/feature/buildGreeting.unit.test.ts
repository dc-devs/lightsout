import { expect, describe, test } from '@jest/globals';
import { buildGreeting } from './buildGreeting';

describe('buildGreeting', () => {
	test('greets the name it is given', () => {
		const greeting = buildGreeting({ name: 'Ada' });

		expect(greeting).toBe('Hello, Ada.');
	});
});
