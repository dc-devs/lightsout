import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LedgerTestRecord } from '#src/contracts/index.ts';
import { ledgerCopyPath } from '#src/pipeline/common/utils/ledgerCopyPath.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	/** One entry per ledger test file: its repo-relative path and every test name the ledger assigns to it. */
	files: { path: string; testNames: string[] }[];
}

/**
 * Take the run's copy of each ledger test file and hash the bytes on disk —
 * the other half of `restoreLedgerTests`, which restores those copies. Called
 * after the formatter has run, so the hash is of formatted bytes and every
 * later format pass is a no-op on a locked file.
 */
export const lockLedgerTests = async ({ run, files }: Params): Promise<LedgerTestRecord[]> => {
	const { runId } = run.current();
	const records: LedgerTestRecord[] = [];

	for (const file of files) {
		const content = await readFile(join(run.cwd, file.path));
		const copy = ledgerCopyPath({ cwd: run.cwd, runId, path: file.path });

		await mkdir(dirname(copy), { recursive: true });
		await writeFile(copy, content);
		records.push({ path: file.path, testNames: file.testNames, sha256: sha256({ content }) });
	}

	return records;
};
