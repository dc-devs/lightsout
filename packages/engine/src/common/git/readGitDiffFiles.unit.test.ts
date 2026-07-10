import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readGitDiffFiles } from './readGitDiffFiles';
import { setupConsumerRepo } from '../../../tests/helpers/setupConsumerRepo';

test('lists a modified tracked file against a committed base', async () => {
	const dir = setupConsumerRepo({ git: true });

	writeFileSync(join(dir, 'src/index.js'), 'export const one = 2;\n');

	const files = await readGitDiffFiles({ cwd: dir, base: 'HEAD' });

	assert.ok(files.includes('src/index.js'));
});

test('lists a deleted tracked file', async () => {
	const dir = setupConsumerRepo({ git: true });

	rmSync(join(dir, 'src/index.js'));

	const files = await readGitDiffFiles({ cwd: dir, base: 'HEAD' });

	assert.ok(files.includes('src/index.js'));
});

test('throws on a bogus base ref', async () => {
	const dir = setupConsumerRepo({ git: true });

	await assert.rejects(readGitDiffFiles({ cwd: dir, base: 'no-such-ref' }));
});
