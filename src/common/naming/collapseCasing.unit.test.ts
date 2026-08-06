import { expect, test } from '@jest/globals';
import { collapseCasing } from '@/common/naming/collapseCasing';

test('collapseCasing: casing/separator variants collapse to one key', () => {
	expect(collapseCasing('GetStarted')).toBe(collapseCasing('get-started'));
	expect(collapseCasing('get_started')).toBe(collapseCasing('getStarted'));
	expect(collapseCasing('getStarted')).not.toBe(collapseCasing('getStartedNow'));
});

test('collapseCasing: the key is bare lowercase alphanumerics, in source order', () => {
	expect(collapseCasing('GetStarted')).toBe('getstarted');
	expect(collapseCasing('get-started_now.v2')).toBe('getstartednowv2');
	expect(collapseCasing('session-response.model')).toBe('sessionresponsemodel');
	// a name of pure separators collapses to nothing
	expect(collapseCasing('---')).toBe('');
});
