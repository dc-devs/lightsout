import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { writeSystemPromptFile } from './writeSystemPromptFile';

test('writeSystemPromptFile: the file round-trips the system prompt byte-for-byte', async () => {
	const systemPrompt = '# Role\n\nTabs\tand — unicode — plus a trailing newline\n';

	const { path, cleanup } = await writeSystemPromptFile({ systemPrompt });

	assert.equal(await readFile(path, 'utf8'), systemPrompt);

	await cleanup();
});

test('writeSystemPromptFile: concurrent spawns get distinct paths', async () => {
	const [first, second] = await Promise.all([
		writeSystemPromptFile({ systemPrompt: 'first' }),
		writeSystemPromptFile({ systemPrompt: 'second' }),
	]);

	assert.notEqual(first.path, second.path, 'two spawns never share a file');
	assert.equal(await readFile(first.path, 'utf8'), 'first');
	assert.equal(await readFile(second.path, 'utf8'), 'second');

	await Promise.all([first.cleanup(), second.cleanup()]);
});

test('writeSystemPromptFile: cleanup removes the file and its directory, and is safe to call twice', async () => {
	const { path, cleanup } = await writeSystemPromptFile({ systemPrompt: 'role' });

	await cleanup();

	assert.equal(existsSync(path), false, 'the prompt file is gone');
	assert.equal(existsSync(dirname(path)), false, 'its directory is gone too');

	await cleanup();
});
