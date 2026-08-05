import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Params {
	systemPrompt: string;
}

/**
 * Write the appended system prompt to a per-spawn temp file for
 * `--append-system-prompt-file`: role + plan + standards can run to hundreds of
 * kilobytes, and argv shares a fixed OS ceiling. Each call gets its own
 * directory so concurrent spawns cannot collide.
 *
 * @param systemPrompt - the full appended system prompt to hand the harness
 * @returns the file path to pass to the harness, and a `cleanup` that removes the directory and never throws
 */
export const writeSystemPromptFile = async ({ systemPrompt }: Params): Promise<{ path: string; cleanup: () => Promise<void> }> => {
	const dir = await mkdtemp(join(tmpdir(), 'lightsout-system-prompt-'));
	const path = join(dir, 'system-prompt.md');

	await writeFile(path, systemPrompt, 'utf8');

	return { path, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => undefined) };
};
