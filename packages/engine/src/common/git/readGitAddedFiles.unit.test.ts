import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readGitAddedFiles } from './readGitAddedFiles';
import { setupConsumerRepo } from '../../../tests/helpers/setupConsumerRepo';

test('an untracked file is new; a modified tracked file is not', async () => {
	const dir = setupConsumerRepo({ git: true });

	writeFileSync(join(dir, 'src/fresh.js'), 'export const fresh = 1;\n');
	writeFileSync(join(dir, 'src/index.js'), 'export const one = 2;\n');

	const added = await readGitAddedFiles({ cwd: dir });

	assert.ok(added.includes('src/fresh.js'), 'untracked file is new');
	assert.ok(!added.includes('src/index.js'), 'a modified tracked file is not new');
});

test('a staged-added file is new', async () => {
	const dir = setupConsumerRepo({ git: true });

	writeFileSync(join(dir, 'src/staged.js'), 'export const staged = 1;\n');
	execSync('git add src/staged.js', { cwd: dir });

	const added = await readGitAddedFiles({ cwd: dir });

	assert.ok(added.includes('src/staged.js'));
});

test('with a base ref, files added since the base are new and modified ones are not', async () => {
	const dir = setupConsumerRepo({ git: true });

	writeFileSync(join(dir, 'src/added.js'), 'export const added = 1;\n');
	writeFileSync(join(dir, 'src/index.js'), 'export const one = 2;\n');
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm second', { cwd: dir });

	const added = await readGitAddedFiles({ cwd: dir, base: 'HEAD~1' });

	assert.ok(added.includes('src/added.js'), 'added-since-base file is new');
	assert.ok(!added.includes('src/index.js'), 'modified-since-base file is not new');
});
