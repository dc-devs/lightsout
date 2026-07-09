import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightsoutConfig } from './index';

const base = { scripts: { check: 'c', testUnit: 't', testCoverage: false } };

test('LightsoutConfig: a stale traverse key parses without error and is stripped from the result', () => {
	const parsed = LightsoutConfig.parse({ ...base, traverse: { connections: 'docs/connections' } });

	assert.equal(LightsoutConfig.safeParse({ ...base, traverse: { connections: 'docs/connections' } }).success, true, 'a leftover traverse block is silently ignored, not an error (decision 4: zod strips unknown keys)');
	assert.equal('traverse' in parsed, false, 'the removed capability leaves no traverse key on the parsed config');
});
