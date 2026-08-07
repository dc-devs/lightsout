import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { isInertSourceFile } from '@/common/utils/isInertSourceFile';
import type { PipelineRun } from '@/pipeline/PipelineRun';

interface Params {
	run: PipelineRun;
	candidates: string[];
	/** The consumer's TypeScript module, or undefined — nothing is classified inert without one. */
	compiler: typeof ts | undefined;
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
 *   exactly like the scan's AST tier; without one, nothing is inert.
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
}: Params): Promise<{ targets: string[]; inert: string[]; deleted: string[] }> => {
	const targets: string[] = [];
	const inert: string[] = [];
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

		if (compiler && isInertSourceFile({ path: file, content, compiler })) {
			inert.push(file);
		} else {
			targets.push(file);
		}
	}

	return { targets, inert, deleted };
};
