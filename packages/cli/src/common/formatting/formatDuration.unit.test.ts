import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration } from './formatDuration';

test('formatDuration: em-dash for undefined, bare seconds under a minute, padded m/s at or above', () => {
	assert.equal(formatDuration({ ms: undefined }), '—');
	assert.equal(formatDuration({ ms: 5400 }), '5s');
	assert.equal(formatDuration({ ms: 60000 }), '1m 00s');
	assert.equal(formatDuration({ ms: 65000 }), '1m 05s');
	assert.equal(formatDuration({ ms: 125000 }), '2m 05s');
});
