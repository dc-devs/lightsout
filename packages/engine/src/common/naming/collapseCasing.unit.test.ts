import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collapseCasing } from './collapseCasing';

test('collapseCasing: casing/separator variants collapse to one key', () => {
	assert.equal(collapseCasing('GetStarted'), collapseCasing('get-started'));
	assert.equal(collapseCasing('get_started'), collapseCasing('getStarted'));
	assert.notEqual(collapseCasing('getStarted'), collapseCasing('getStartedNow'));
});
