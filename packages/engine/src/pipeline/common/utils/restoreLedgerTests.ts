import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import { ledgerCopyPath } from '#src/pipeline/common/utils/ledgerCopyPath.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The lock, run at every verify step ahead of the gates: the party being
 * verified never edits the verifier. A ledger test file that differs from the
 * copy the write-ledger-tests step took — edited, truncated, or deleted — is
 * replaced by that copy, so the gates that follow run against the tests the
 * plan named.
 *
 * It never reports a missing test name: the writer step proved every name
 * present before it took the copy, and the copy is what is restored. Nothing
 * here runs a gate.
 *
 * @returns the repo-relative paths that were put back; empty when nothing was touched.
 */
export const restoreLedgerTests = async ({ run }: Params): Promise<{ restored: string[] }> => {
	const { runId, ledgerTests } = run.current();
	const restored: string[] = [];

	for (const record of ledgerTests) {
		const live = join(run.cwd, record.path);
		const content = await readFile(live).catch(() => undefined);

		if (content !== undefined && sha256({ content }) === record.sha256) {
			continue;
		}

		await mkdir(dirname(live), { recursive: true });
		await copyFile(ledgerCopyPath({ cwd: run.cwd, runId, path: record.path }), live);
		restored.push(record.path);
	}

	return { restored };
};
