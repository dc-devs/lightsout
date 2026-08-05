import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { parseFlags } from '@/cli/common/args/parseFlags';

test('getStringFlag: returns the string value, undefined for a boolean flag, undefined when absent', () => {
	const flags = parseFlags({ args: ['--name', 'bar', '--all'] });

	assert.equal(getStringFlag({ flags, name: 'name' }), 'bar');
	assert.equal(getStringFlag({ flags, name: 'all' }), undefined);
	assert.equal(getStringFlag({ flags, name: 'missing' }), undefined);
});
