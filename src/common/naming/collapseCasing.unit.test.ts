import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collapseCasing } from '@/common/naming/collapseCasing';

test('collapseCasing: casing/separator variants collapse to one key', () => {
	assert.equal(collapseCasing('GetStarted'), collapseCasing('get-started'));
	assert.equal(collapseCasing('get_started'), collapseCasing('getStarted'));
	assert.notEqual(collapseCasing('getStarted'), collapseCasing('getStartedNow'));
});

test('collapseCasing: the key is bare lowercase alphanumerics, in source order', () => {
	assert.equal(collapseCasing('GetStarted'), 'getstarted');
	assert.equal(collapseCasing('get-started_now.v2'), 'getstartednowv2');
	assert.equal(collapseCasing('session-response.model'), 'sessionresponsemodel');
	assert.equal(collapseCasing('---'), '', 'a name of pure separators collapses to nothing');
});
