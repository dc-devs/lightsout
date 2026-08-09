import { expect, describe, test, beforeEach } from '@jest/globals';

let mode: string;
let subject: string;

describe('comparedLet', () => {
	beforeEach(() => {
		const widths = ['ready'].map(mode => mode.length);

		subject = mode === 'ready' ? String(widths[0]) : 'idle';
	});

	test('reads the subject', () => {
		expect(subject).toBe('idle');
	});
});
