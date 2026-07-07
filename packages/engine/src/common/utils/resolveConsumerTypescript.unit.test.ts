import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveConsumerTypescript } from './resolveConsumerTypescript';
import { linkTypescript } from '../../../tests/helpers/linkTypescript';

test('resolveConsumerTypescript: a RELATIVE cwd resolves too (createRequire rejects relative paths — observed live with --cwd .)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-tsres-'));

	linkTypescript({ dir });

	const previousCwd = process.cwd();

	process.chdir(dir);

	try {
		assert.notEqual(resolveConsumerTypescript({ cwd: '.' }), undefined, 'relative cwd must anchor to an absolute path before createRequire');
		assert.notEqual(resolveConsumerTypescript({ cwd: dir }), undefined, 'absolute cwd resolves');
	} finally {
		process.chdir(previousCwd);
	}
});
