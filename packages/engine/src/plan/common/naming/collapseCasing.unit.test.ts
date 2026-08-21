import { describe, expect, test } from '@jest/globals';
import { collapseCasing } from '#src/plan/common/naming/collapseCasing.ts';

describe('collapseCasing', () => {
	test.each([
		{ name: 'GetStarted', expected: 'getstarted' },
		{ name: 'get-started', expected: 'getstarted' },
		{ name: 'get_started', expected: 'getstarted' },
		{ name: 'getStarted', expected: 'getstarted' },
	])('reads $name as $expected, so a name spelled for two conventions compares equal', ({ name, expected }) => {
		const collapsed = collapseCasing({ name });

		expect(collapsed).toBe(expected);
	});

	test.each([
		{ name: 'get-started_now.v2', expected: 'getstartednowv2' },
		{ name: 'session-response.model', expected: 'sessionresponsemodel' },
	])('drops every separator, so $name reads as $expected', ({ name, expected }) => {
		const collapsed = collapseCasing({ name });

		expect(collapsed).toBe(expected);
	});

	test('a name of pure separators collapses to nothing', () => {
		const collapsed = collapseCasing({ name: '---' });

		expect(collapsed).toBe('');
	});

	test('two genuinely different names stay different', () => {
		const collapsed = collapseCasing({ name: 'getStartedNow' });

		expect(collapsed).not.toBe('getstarted');
	});
});
