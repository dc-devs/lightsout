import { expect, describe, test, beforeEach } from '@jest/globals';

let subject: string;

describe('sharedLet', () => {
	beforeEach(() => {
		subject = 'ready';
	});

	test('reads the subject', () => {
		expect(subject).toBe('ready');
	});
});
