import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { packageOf } from '#src/common/workspace/packageOf.ts';
import type { WorkReport } from '#src/contracts/index.ts';
import { consumerRelative } from '#src/pipeline/common/utils/consumerRelative.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	reports: WorkReport[];
}

/**
 * Merge the two sources of changed-file truth: what agents reported and
 * what git actually observed (minus the run's baseline dirt). Agents can
 * forget files; git cannot be sweet-talked. Also widens the package scope
 * to whatever the changed files reveal — declared scope is a starting
 * point, changed files are the truth; scope never shrinks.
 */
export const collectChanged = async ({ run, gitPrefix, reports }: Params): Promise<{ changedFiles: string[]; packages: string[] }> => {
	// Generated/derived files (configured prefixes) are like gate artifacts:
	// real in the diff, but never attributed — their source is the change.
	const isGeneratedFile = ({ file }: { file: string }) => (run.config.generated ?? []).some((prefix) => file.startsWith(prefix));
	const packagesDir = run.config['packages-dir'] ?? defaultPackagesDir;
	const fromGit = ((await readGitChangedFiles({ cwd: run.cwd })) ?? []).filter(
		(file) => !run.current().baselineDirtyFiles.includes(file) && !isGeneratedFile({ file }),
	);
	const fromReports = reports
		.flatMap((report) => report.changedFiles.map((file) => consumerRelative({ gitPrefix, file: file.path })))
		.filter((file) => !isGeneratedFile({ file }));
	const changedFiles = [...new Set([...run.current().changedFiles, ...fromReports, ...fromGit])];
	const fromFiles = changedFiles.flatMap((file) => {
		const packageDir = packageOf({ file, packagesDir });

		return packageDir ? [packageDir] : [];
	});

	return { changedFiles, packages: [...new Set([...run.current().packages, ...fromFiles])] };
};
