import { dirname } from 'node:path';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { collectBatchChanges } from '#src/common/utils/collectBatchChanges.ts';
import { packageOf } from '#src/common/workspace/packageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	batchId: string;
	/** Paths the batch's agents have claimed so far, merged with git truth. */
	reportedFiles: Set<string>;
	/** Files earlier steps already attributed — excluded from this batch's git-truth merge. */
	attributedFiles: string[];
}

/**
 * True for the coverage tooling's own output — the measurement must never fail
 * the run it serves, exactly as generated paths never do. A package writes its
 * summary under its own directory, so the check reads both spellings.
 */
const isMeasurementOutput = ({ path, coverageDir, packagesDir }: { path: string; coverageDir: string; packagesDir: string }) => {
	const owner = packageOf({ file: path, packagesDir });
	const withinPackage = owner === undefined ? path : path.slice(`${packagesDir}/${owner}/`.length);

	return path.startsWith(`${coverageDir}/`) || withinPackage.startsWith(`${coverageDir}/`);
};

/**
 * The batch's changed files with the measurement's own artifacts dropped, and
 * the tests-only verdict on what is left: a coverage run may add tests and
 * nothing else, so a source file among the changes is an error naming what a
 * human must undo.
 *
 * Run after every invocation — a fix agent can reach for source exactly as the
 * first one can.
 */
export const checkTestsOnly = async ({
	cwd,
	config,
	batchId,
	reportedFiles,
	attributedFiles,
}: Params): Promise<{ changedFiles: string[]; error: string | undefined }> => {
	const coverageDir = dirname(config['coverage-summary-path'] ?? defaultCoverageSummaryPath);
	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const changedFiles = (await collectBatchChanges({ cwd, config, reportedFiles, attributedFiles })).filter(
		(path) => !isMeasurementOutput({ path, coverageDir, packagesDir }),
	);
	const offenders = changedFiles.filter((path) => !isTestFile({ path }));

	return {
		changedFiles,
		error:
			offenders.length === 0
				? undefined
				: `${batchId}: this run may change no source file, but these are modified:\n${offenders.map((path) => `  ${path}`).join('\n')}\nThe tree is left as it stands — revert these changes by hand before resuming, since the engine never reverts and a resumed run would measure the contaminated tree.`,
	};
};
