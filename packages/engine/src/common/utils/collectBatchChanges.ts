import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Every path a batch's agents reported naming (fix invocations included). */
	reportedFiles: Set<string>;
	/** Files earlier steps already attributed — excluded from the git-truth merge. */
	attributedFiles: string[];
}

/**
 * A batch's changed files: every invocation's report unioned with git truth
 * minus earlier steps' attributions and generated paths — agents can forget
 * files; git cannot be sweet-talked.
 */
export const collectBatchChanges = async ({ cwd, config, reportedFiles, attributedFiles }: Params): Promise<string[]> => {
	const attributed = new Set(attributedFiles);
	const isGenerated = ({ file }: { file: string }) => (config.generated ?? []).some((prefix) => file.startsWith(prefix));
	const fromGit = ((await readGitChangedFiles({ cwd })) ?? []).filter((file) => !attributed.has(file) && !isGenerated({ file }));

	return [...new Set([...reportedFiles, ...fromGit])];
};
