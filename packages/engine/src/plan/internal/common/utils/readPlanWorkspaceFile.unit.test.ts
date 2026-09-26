import { execSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { z } from 'zod';
import { readPlanWorkspaceFile } from '#src/plan/internal/common/utils/readPlanWorkspaceFile.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** A stand-in boundary schema: the reader's contract is that it parses, not which record it parses. */
const FactsRecord = z.object({ planName: z.string(), pathsChecked: z.number() });

/** The error a caller supplies for a file it could not read — it receives the absolute path. */
const notFound = (filePath: string) => `no record at ${filePath}`;

/**
 * A repo whose plan folder holds exactly the given file text. Pass no text and
 * the file is never written, which is the case a reader hits on a plan folder
 * restored without it.
 */
const setupWorkspaceFile = ({ text }: { text?: string } = {}) => {
	const cwd = setupConsumerRepo();
	const name = 'lo-150-planning-observability';
	const dir = planWorkspaceFolder({ cwd: cwd, name: name });

	mkdirSync(dir, { recursive: true });

	if (text !== undefined) {
		writeFileSync(join(dir, 'facts.json'), text, 'utf8');
	}

	return { cwd, name, path: join(dir, 'facts.json') };
};

/**
 * A primary checkout holding the plan's record, with a linked worktree cut from
 * it — the shape every plan reader runs in once plan data stays in the main
 * checkout whichever tree the command was launched from.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const name = 'lo-150-planning-observability';
	const worktree = join(cwd, '.worktrees', name);
	// git answers with a fully resolved path, so the record is planted where the
	// reader will look — macOS's symlinked temp directory otherwise hides it.
	const dir = planWorkspaceFolder({ cwd: realpathSync(cwd), name });

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'facts.json'), JSON.stringify({ planName: name, pathsChecked: 12 }), 'utf8');
	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { name, worktree };
};

describe('readPlanWorkspaceFile', () => {
	test("reads and parses a record from the plan's own folder", async () => {
		const { cwd, name } = setupWorkspaceFile({ text: JSON.stringify({ planName: 'lo-150-planning-observability', pathsChecked: 4 }) });

		const record = await readPlanWorkspaceFile({ cwd, name, fileName: 'facts.json', schema: FactsRecord, notFound });

		expect(record).toStrictEqual({ planName: 'lo-150-planning-observability', pathsChecked: 4 });
	});

	test("a missing record throws the caller's message, carrying the absolute path it looked at", async () => {
		const { cwd, name, path } = setupWorkspaceFile();

		// the path is the whole value of the message: it says which folder was read,
		// which is the only way to tell a missing file from a file in another checkout
		await expect(readPlanWorkspaceFile({ cwd, name, fileName: 'facts.json', schema: FactsRecord, notFound })).rejects.toThrow(`no record at ${path}`);
	});

	test('a record the schema rejects throws rather than answering a half-read value', async () => {
		const { cwd, name } = setupWorkspaceFile({ text: JSON.stringify({ planName: 'lo-150-planning-observability' }) });

		await expect(readPlanWorkspaceFile({ cwd, name, fileName: 'facts.json', schema: FactsRecord, notFound })).rejects.toThrow();
	});

	test('a record held by the primary checkout is read from inside a linked worktree', async () => {
		const { name, worktree } = setupLinkedWorktree();

		const record = await readPlanWorkspaceFile({ cwd: worktree, name, fileName: 'facts.json', schema: FactsRecord, notFound });

		// read against the worktree, every plan record would come back as the
		// caller's not-found error on a plan that is drafted and sitting on disk
		expect(record).toStrictEqual({ planName: name, pathsChecked: 12 });
	});
});
