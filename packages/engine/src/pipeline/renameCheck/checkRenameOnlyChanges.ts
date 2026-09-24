import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitChangeKind } from '#src/common/constants/GitChangeKind.ts';
import { readGitCommittedFile } from '#src/common/git/readGitCommittedFile.ts';
import { readGitWorkingChanges } from '#src/common/git/readGitWorkingChanges.ts';
import { isGeneratedPath } from '#src/common/sourceFiles/isGeneratedPath.ts';
import type { RenameRule } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { applyRenames } from '#src/pipeline/renameCheck/common/utils/applyRenames.ts';
import { countTokens } from '#src/pipeline/renameCheck/common/utils/countTokens.ts';

interface Params {
	run: PipelineRun;
	/** The verification checkpoint in flight — it labels the progress lines. */
	checkpoint: string;
	/** The plan's declared renames, in declared order. Never empty: the caller only asks for this check on a rename-only plan. */
	renames: RenameRule[];
}

/** One changed file to compare: where it started at `HEAD`, and where it sits now. */
interface Comparison {
	startPath: string;
	currentPath: string;
}

/**
 * The tokens one side holds more of than the other, each with how many more,
 * written for the refusal message. At most twenty are listed, so one rewritten
 * file cannot bury the others.
 */
const describeSurplus = ({ more, less }: { more: Map<string, number>; less: Map<string, number> }) => {
	const listedTokenLimit = 20;
	const surplus = [...more].flatMap(([token, count]) => (count > (less.get(token) ?? 0) ? [`\`${token}\` ×${count - (less.get(token) ?? 0)}`] : []));
	const listed = surplus.slice(0, listedTokenLimit).join(', ');

	return surplus.length > listedTokenLimit ? `${listed} and ${surplus.length - listedTokenLimit} more` : listed;
};

/**
 * Pair every removed path with the added path its renamed path names; what is
 * left unpaired on either side is a file a rename cannot explain — a rename
 * moves a file, it never creates or deletes one.
 */
const pairChanges = ({ removed, added, modified, renames }: { removed: string[]; added: string[]; modified: string[]; renames: RenameRule[] }) => {
	const unclaimed = new Set(added);
	const comparisons: Comparison[] = modified.map((path) => ({ startPath: path, currentPath: path }));
	const refusals: string[] = [];

	for (const path of removed) {
		const destination = applyRenames({ text: path, renames });

		if (destination === path) {
			refusals.push(`- ${path}: removed, and no declared rename applies to its path`);
		} else if (unclaimed.delete(destination)) {
			comparisons.push({ startPath: path, currentPath: destination });
		} else {
			refusals.push(`- ${path}: removed, but nothing was added at its renamed path ${destination}`);
		}
	}

	for (const path of unclaimed) {
		refusals.push(`- ${path}: added, but no removed file renames to it`);
	}

	return { comparisons, refusals };
};

/** The refusal line for one compared file, or undefined when its tokens agree once the renames are applied to both sides. */
const compareContent = async ({ run, comparison, renames }: { run: PipelineRun; comparison: Comparison; renames: RenameRule[] }) => {
	const { startPath, currentPath } = comparison;
	// `git show HEAD:<path>` resolves from the repository root; the `./` prefix
	// makes git resolve it against the working directory, so a nested consumer
	// does not read every file as untracked.
	const start = (await readGitCommittedFile({ cwd: run.cwd, path: `./${startPath}` })) ?? '';
	const current = (await readFile(join(run.cwd, currentPath), 'utf8').catch(() => undefined)) ?? '';
	const before = countTokens({ text: applyRenames({ text: start, renames }) });
	const after = countTokens({ text: applyRenames({ text: current, renames }) });
	const addedTokens = describeSurplus({ more: after, less: before });
	const removedTokens = describeSurplus({ more: before, less: after });
	const label = startPath === currentPath ? currentPath : `${currentPath} (moved from ${startPath})`;

	return addedTokens === '' && removedTokens === '' ? undefined : `- ${label}: added ${addedTokens || 'nothing'}; removed ${removedTokens || 'nothing'}`;
};

/**
 * The removed paths `HEAD` tracks. A path git reports removed that `HEAD` never
 * held was created and deleted within the run — absent from both sides, it is no
 * change at all.
 */
const removedSinceHead = async ({ run, paths }: { run: PipelineRun; paths: string[] }) => {
	const tracked: string[] = [];

	for (const path of paths) {
		if ((await readGitCommittedFile({ cwd: run.cwd, path: `./${path}` })) !== undefined) {
			tracked.push(path);
		}
	}

	return tracked;
};

/**
 * The deterministic judgment a rename-only plan's checkpoint runs in place of
 * the agent test-change review: every file the phase changed must differ from
 * `HEAD` only by the declared renames.
 *
 * `HEAD` is the phase's starting state, because a phase run commits only when it
 * passes — and it is the same answer on a resume. Files dirty before the run,
 * configured generated paths and the engine's own run state are left out. Both
 * sides have the renames applied and must then hold the same multiset of tokens,
 * whitespace and trailing commas ignored: the formatter re-wraps lines and
 * re-sorts imports when their paths change, and none of that is a change the
 * renames fail to explain.
 *
 * It writes nothing to the working tree or the manifest, and it fails closed:
 * when git cannot report the working changes, nothing is proven and the
 * checkpoint is refused.
 *
 * @returns an empty object when every changed file holds only the declared renames; `error` naming each refused file otherwise.
 */
export const checkRenameOnlyChanges = async ({ run, checkpoint, renames }: Params): Promise<{ error?: string }> => {
	const changes = await readGitWorkingChanges({ cwd: run.cwd });

	if (changes === undefined) {
		return { error: `${checkpoint}: the rename check could not read the working changes from git, so nothing is proven; no gate ran.` };
	}

	const baselineDirty = new Set(run.current().baselineDirtyFiles);
	const generated = run.config.generated ?? [];
	const inScope = changes.filter(({ path }) => !baselineDirty.has(path) && !isGeneratedPath({ path, generated }));
	const pathsOf = ({ kind }: { kind: GitChangeKind }) => inScope.filter((change) => change.kind === kind).map((change) => change.path);
	const removed = await removedSinceHead({ run, paths: pathsOf({ kind: GitChangeKind.Removed }) });
	const added = pathsOf({ kind: GitChangeKind.Added });
	const modified = pathsOf({ kind: GitChangeKind.Modified });

	run.progress(
		`${checkpoint}: rename check — comparing ${removed.length + added.length + modified.length} changed file(s) against the phase's starting commit`,
	);

	const { comparisons, refusals } = pairChanges({ removed, added, modified, renames });

	for (const comparison of comparisons) {
		const refusal = await compareContent({ run, comparison, renames });

		if (refusal !== undefined) {
			refusals.push(refusal);
		}
	}

	if (refusals.length === 0) {
		run.progress(`${checkpoint}: rename check — every changed file holds only the declared renames`);
	}

	return refusals.length === 0 ? {} : { error: [`${checkpoint}: the rename check refused this checkpoint's changes; no gate ran.`, ...refusals].join('\n') };
};
