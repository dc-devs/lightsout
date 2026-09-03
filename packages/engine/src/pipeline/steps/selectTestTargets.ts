import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { isInertSourceFile } from '#src/common/sourceFiles/isInertSourceFile.ts';
import { isToolingConfigFile } from '#src/common/sourceFiles/isToolingConfigFile.ts';
import { selectCollectedFiles, selectUnloadableFiles } from '#src/coverage/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	candidates: string[];
	/** The consumer's TypeScript module, or undefined — nothing is classified inert without one. */
	compiler: typeof ts | undefined;
	/** The workspace's packages folder, so a package root is recognised as a root. */
	packagesDir: string;
}

/**
 * Split the write-tests candidates into four buckets:
 *
 * - `deleted` — the plan removed the file, so there is no source to cover.
 *   A deletion reaches here because git reports it as changed (changed-file
 *   truth includes removals, which legitimately widen package scope). Routing
 *   it to a writer asks the agent to test a file that isn't there — a wasted
 *   spawn that returns `stale-references` and escalates the run. Whether a
 *   file exists is a deterministic fact the engine must own, not delegate.
 * - `inert` — barrels and type-only files provably hold no executable code,
 *   so a writer is a guaranteed no-op (or an implementation-coupled test the
 *   standards forbid). Classification borrows the consumer's TypeScript,
 *   exactly like the standards check's AST tier; without one, nothing is inert.
 * - `uncoverable` — the file holds real code, but no unit test can ever run it:
 *   a tool's own settings file is read by that tool and imported by nothing, a
 *   file with a module-scope `await` cannot be loaded at all when the Jest
 *   configuration governing its coverage scope loads it as CommonJS (under a
 *   Jest configured for ES modules the same file loads fine and keeps its
 *   writer), and a file the repo's own coverage configuration does not collect
 *   can never move the number the execution gate reads. Kept apart from `inert`
 *   so the run says which of the two it skipped, rather than calling real code
 *   type-only.
 * - `targets` — everything with runtime code to cover.
 *
 * Deletion filtering runs regardless of the compiler; only inert
 * classification needs it. A file still on disk but transiently unreadable
 * keeps its writer — the prior tolerance, never a lost writer.
 *
 * The coverage-excluded files are also returned under `coverageExcluded` — a
 * labelled subset of `uncoverable`, not a fifth bucket — so the step recording
 * them on the manifest never has to re-derive the answer.
 */
export const selectTestTargets = async ({
	run,
	candidates,
	compiler,
	packagesDir,
}: Params): Promise<{ targets: string[]; inert: string[]; uncoverable: string[]; deleted: string[]; coverageExcluded: string[] }> => {
	const { excluded } = await selectCollectedFiles({ cwd: run.cwd, config: run.config, files: candidates });
	const { unloadable } = await selectUnloadableFiles({ cwd: run.cwd, config: run.config, files: candidates, compiler });
	const uncollected = new Set(excluded);
	const unloadableFiles = new Set(unloadable);
	const targets: string[] = [];
	const inert: string[] = [];
	const uncoverable: string[] = [];
	const deleted: string[] = [];
	const coverageExcluded: string[] = [];

	for (const file of candidates) {
		const content = await readFile(join(run.cwd, file), 'utf8').catch(() => undefined);

		if (content === undefined) {
			// Unreadable: a plan-deleted file has no source to cover — drop it.
			// A file still on disk (transiently unreadable) keeps its writer.
			const exists = await stat(join(run.cwd, file)).then(
				() => true,
				() => false,
			);

			(exists ? targets : deleted).push(file);
			continue;
		}

		const excludedFromCoverage = uncollected.has(file);

		if (isToolingConfigFile({ path: file, packagesDir }) || excludedFromCoverage || unloadableFiles.has(file)) {
			uncoverable.push(file);

			if (excludedFromCoverage) {
				coverageExcluded.push(file);
			}
		} else if (compiler && isInertSourceFile({ path: file, content, compiler })) {
			inert.push(file);
		} else {
			targets.push(file);
		}
	}

	return { targets, inert, uncoverable, deleted, coverageExcluded };
};
