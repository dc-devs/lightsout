import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@jest/globals';
import { writeSystemPromptFile } from '#src/drivers/common/utils/writeSystemPromptFile.ts';

test('writeSystemPromptFile: the file round-trips the system prompt byte-for-byte', async () => {
	const systemPrompt = '# Role\n\nTabs\tand — unicode — plus a trailing newline\n';

	const { path, cleanup } = await writeSystemPromptFile({ systemPrompt });

	expect(await readFile(path, 'utf8')).toBe(systemPrompt);

	await cleanup();
});

test('writeSystemPromptFile: concurrent spawns get distinct paths', async () => {
	const [first, second] = await Promise.all([writeSystemPromptFile({ systemPrompt: 'first' }), writeSystemPromptFile({ systemPrompt: 'second' })]);

	// two spawns never share a file
	expect(first.path).not.toBe(second.path);
	expect(await readFile(first.path, 'utf8')).toBe('first');
	expect(await readFile(second.path, 'utf8')).toBe('second');

	await Promise.all([first.cleanup(), second.cleanup()]);
});

test('writeSystemPromptFile: cleanup removes the file and its directory, and is safe to call twice', async () => {
	const { path, cleanup } = await writeSystemPromptFile({ systemPrompt: 'role' });

	await cleanup();

	// the prompt file is gone
	expect(existsSync(path)).toBe(false);
	// its directory is gone too
	expect(existsSync(dirname(path))).toBe(false);

	await cleanup();
});
