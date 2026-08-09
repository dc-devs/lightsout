import { expect, describe, test } from '@jest/globals';
import { collapseCasing } from './collapseCasing.ts';

describe('collapseCasing', () => {
	test.each([
		{ name: 'GetStarted', expected: 'getstarted' },
		{ name: 'get-started', expected: 'getstarted' },
		{ name: 'get_started', expected: 'getstarted' },
		{ name: 'events.service', expected: 'eventsservice' },
	])('reads $name as $expected, so a name spelled for two conventions compares equal', ({ name, expected }) => {
		const collapsed = collapseCasing({ name });

		expect(collapsed).toBe(expected);
	});

	test('keeps digits, which carry meaning a casing convention never supplies', () => {
		const collapsed = collapseCasing({ name: 'parseIso8601' });

		expect(collapsed).toBe('parseiso8601');
	});

	test('leaves two genuinely different names different', () => {
		expect(collapseCasing({ name: 'getUserData' })).not.toBe(collapseCasing({ name: 'fetchUserData' }));
	});
});
