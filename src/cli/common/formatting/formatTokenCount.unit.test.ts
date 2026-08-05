import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTokenCount } from '@/cli/common/formatting/formatTokenCount';

test('formatTokenCount: raw under 1k, one-decimal k under 1M, one-decimal M above', () => {
	assert.equal(formatTokenCount({ count: 500 }), '500');
	assert.equal(formatTokenCount({ count: 1000 }), '1.0k');
	assert.equal(formatTokenCount({ count: 1500 }), '1.5k');
	assert.equal(formatTokenCount({ count: 1_000_000 }), '1.0M');
	assert.equal(formatTokenCount({ count: 2_500_000 }), '2.5M');
});
