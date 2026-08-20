import { describe, expect, test } from '@jest/globals';
import { messageOf } from '#src/common/utils/messageOf.ts';

describe('messageOf', () => {
	test('an Error reports its message, not its stringified self', () => {
		expect(messageOf({ error: new Error('gate timed out') })).toBe('gate timed out');
	});

	test('a subclass of Error is still an Error', () => {
		expect(messageOf({ error: new TypeError('not a function') })).toBe('not a function');
	});

	test('a thrown string is the message, since throw accepts any value', () => {
		expect(messageOf({ error: 'something went sideways' })).toBe('something went sideways');
	});

	test('a thrown object is stringified rather than dropped', () => {
		// not useful text, but better than an empty message that says nothing
		expect(messageOf({ error: { code: 'EACCES' } })).toBe('[object Object]');
	});

	test('a thrown undefined still produces something to print', () => {
		expect(messageOf({ error: undefined })).toBe('undefined');
	});
});
