import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { isInertSourceFile } from '#src/common/sourceFiles/isInertSourceFile.ts';
import { isToolingConfigFile } from '#src/common/sourceFiles/isToolingConfigFile.ts';
import { isUnloadableSourceFile } from '#src/common/sourceFiles/isUnloadableSourceFile.ts';
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
 * Split the write-tests candidates into three buckets:
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
 * - `unreachable` — the file holds real code, but no unit test can ever run it:
 *   a tool's own settings file is read by that tool and imported by nothing, and
 *   a file with a module-scope `await` cannot be loaded at all under the
 *   runner's CommonJS output. Kept apart from `inert` so the run says which of
 *   the two it skipped, rather than calling real code type-only.
 * - `targets` — everything with runtime code to cover.
 *
 * Deletion filtering runs regardless of the compiler; only inert
 * classification needs it. A file still on disk but transiently unreadable
 * keeps its writer — the prior tolerance, never a lost writer.
 */
export const selectTestTargets = async ({
	run,
	candidates,
	compiler,
	packagesDir,
}: Params): Promise<{ targets: string[]; inert: string[]; unreachable: string[]; deleted: string[] }> => {
	const targets: string[] = [];
	const inert: string[] = [];
	const unreachable: string[] = [];
	const deleted: string[] = [];

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

		if (isToolingConfigFile({ path: file, packagesDir }) || (compiler && isUnloadableSourceFile({ path: file, content, compiler }))) {
			unreachable.push(file);
		} else if (compiler && isInertSourceFile({ path: file, content, compiler })) {
			inert.push(file);
		} else {
			targets.push(file);
		}
	}

	return { targets, inert, unreachable, deleted };
};
