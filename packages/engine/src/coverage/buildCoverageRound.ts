import type ts from 'typescript';
import { groupConnectedFiles } from '#src/common/fileGroups/groupConnectedFiles.ts';
import { collectImportEdges } from '#src/common/moduleGraph/collectImportEdges.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import type { CoverageFile, CoverageTotal } from '#src/contracts/index.ts';
import { buildCoverageBatch } from '#src/coverage/buildCoverageBatch.ts';
import type { CoverageRound } from '#src/coverage/common/types/CoverageRound.ts';
import type { CoverageSetAside } from '#src/coverage/common/types/CoverageSetAside.ts';
import { selectCoverageCandidates } from '#src/coverage/selectCoverageCandidates.ts';

interface Params {
	cwd: string;
	/** This round's measurement: every measured file, and each scope's own verdict. */
	measured: { files: CoverageFile[]; totals: CoverageTotal[] };
	/** Files already routed to a human — excluded from both the candidates and the writer's members. */
	setAside: CoverageSetAside[];
	/** Repo-relative standards-pack roots, resolved once for the run. */
	standardsPacks: string[];
	/** The consumer's TypeScript module, or undefined — without one, grouping degrades to one file per component. */
	compiler: typeof ts | undefined;
	/** 1-based sequential batch number across the run. */
	batchNumber: number;
}

/**
 * Turn one round's measurement into the batch that round will spend a writer
 * on: the worst file's scope earns the round, and the batch takes whole
 * import-graph components of that scope.
 *
 * Both ways this can come back empty are the run's end, not a batch's: no
 * improvable file left while the gate is still red is a question only a human
 * can answer, and a scope whose candidates its own member pool refuses is an
 * engine bug to surface rather than an empty assignment to spend on.
 */
export const buildCoverageRound = async ({ cwd, measured, setAside, standardsPacks, compiler, batchNumber }: Params): Promise<CoverageRound> => {
	const setAsidePaths = new Set(setAside.flatMap((entry) => entry.files));
	const candidates = await selectCoverageCandidates({ cwd, measured, setAsidePaths, standardsPacks, compiler });

	if (candidates.length === 0) {
		return {
			error:
				'coverage gate is red but no improvable file remains — set-aside files need source changes, or the threshold binds on a metric other than statements (branches/functions/lines); human required',
		};
	}

	// The worst file's scope earns the round: a package whose own gate is
	// already green never appears among the candidates at all.
	const scope = candidates[0].scope;
	const memberPool = measured.files
		.filter((file) => file.scope === scope && !setAsidePaths.has(file.path) && !isTestFile({ path: file.path, standardsPacks }))
		.map((file) => file.path);
	const components = compiler
		? groupConnectedFiles({ files: memberPool, edges: await collectImportEdges({ cwd, files: memberPool, compiler }) })
		: memberPool.map((file) => [file]);
	const batch = buildCoverageBatch({ files: candidates.filter((file) => file.scope === scope), components, batchNumber });

	return batch.members.length === 0
		? { error: `scope '${scope}' has candidates but the member pool excludes them all — candidate selection and member filtering disagree; human required` }
		: { batch };
};
