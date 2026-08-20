import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StandardsSnapshot } from '#src/contracts/index.ts';
import { getStandardsCheckPath } from '#src/standardsCheck/common/paths/getStandardsCheckPath.ts';
import { getStandardsSnapshotsDir } from '#src/standardsCheck/common/paths/getStandardsSnapshotsDir.ts';

interface Params {
	cwd: string;
	snapshot: StandardsSnapshot;
}

/**
 * Persist one check result twice: as the latest snapshot — the typed evidence
 * file the refactor pipeline reads as its work-list — and as a dated copy a
 * trend reads.
 *
 * The single writer of both files. Two runs reach it, the standalone check and
 * the CLI command that merges code checks with the agent review, and a format
 * the pipeline parses must not be able to change on one path and not the other.
 * The dated file's name comes from `snapshot.at` rather than a second clock
 * reading, so the pair can never disagree about when the check ran.
 */
export const writeStandardsSnapshot = async ({ cwd, snapshot }: Params): Promise<void> => {
	const body = `${JSON.stringify(snapshot, undefined, '\t')}\n`;
	const snapshotsDir = getStandardsSnapshotsDir({ cwd });
	// Colons and dots are legal in the timestamp and not in a Windows filename.
	const fileName = `${snapshot.at.replaceAll(':', '-').replaceAll('.', '-')}.json`;

	await mkdir(snapshotsDir, { recursive: true });
	await writeFile(getStandardsCheckPath({ cwd }), body, 'utf8');
	await writeFile(join(snapshotsDir, fileName), body, 'utf8');
};
