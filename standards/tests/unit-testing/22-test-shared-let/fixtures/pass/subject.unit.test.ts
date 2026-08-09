import { expect, describe, test } from '@jest/globals';

const setupSubject = () => ({ subject: 'ready' });

describe('subject', () => {
	test('reads the subject', () => {
		const { subject } = setupSubject();

		expect(subject).toBe('ready');
	});
});
