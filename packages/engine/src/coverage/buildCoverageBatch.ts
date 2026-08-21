import { chunkFileGroup } from '#src/common/fileGroups/chunkFileGroup.ts';
import type { CoverageFile } from '#src/contracts/index.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';

const defaultBatchSize = 5;
/** The implement fan-out's writer cap: an import component above this splits into sorted chunks rather than drowning one invocation. */
const maxWriterGroupFiles = 12;

interface Params {
	/** Candidates, worst-first, set-aside files already excluded. */
	files: CoverageFile[];
	/** Import-graph components over the batch scope's measured files (groupConnectedFiles output: each sorted, deterministic order). Singleton groups when the consumer has no TypeScript. */
	components: string[][];
	/** 1-based sequential batch number across the run. */
	batchNumber: number;
	/** Tracked-candidate fill target. */
	batchSize?: number;
}

/**
 * Fill one batch with whole import-graph components, worst-first.
 *
 * Selecting files one at a time routinely hands the test writer an internal
 * whose module boundary it is forbidden to touch, so it declines for a
 * structural reason rather than a real one. Taking the component whole keeps a
 * module's boundary beside its internals: well-covered members ride along as
 * context, and only the candidates below the bar are tracked for improvement.
 */
export const buildCoverageBatch = ({ files, components, batchNumber, batchSize = defaultBatchSize }: Params): CoverageBatch => {
	const scope = files[0].scope;
	const candidateByPath = new Map(files.map((file) => [file.path, file]));
	const candidatesOf = ({ members }: { members: string[] }) => members.flatMap((path) => candidateByPath.get(path) ?? []);
	const worstOf = ({ candidates }: { candidates: CoverageFile[] }) => Math.min(...candidates.map((candidate) => candidate.statementsPct));

	// A component too large for one writer splits into sorted chunks, and the
	// chunk holding the worst candidate is the one this batch takes.
	const groupOf = ({ component }: { component: string[] }) => {
		const candidates = candidatesOf({ members: component });

		if (component.length <= maxWriterGroupFiles || candidates.length === 0) {
			return { members: component, candidates };
		}

		const worst = candidates.sort((left, right) => left.statementsPct - right.statementsPct || left.path.localeCompare(right.path))[0];
		const members = chunkFileGroup({ files: component, max: maxWriterGroupFiles })
			.filter((chunk) => chunk.includes(worst.path))
			.flat();

		return { members, candidates: candidatesOf({ members }) };
	};

	const ranked = components
		.map((component) => groupOf({ component }))
		.filter((group) => group.candidates.length > 0)
		.sort(
			(left, right) => worstOf({ candidates: left.candidates }) - worstOf({ candidates: right.candidates }) || left.members[0].localeCompare(right.members[0]),
		);

	const members: string[] = [];
	const tracked: CoverageFile[] = [];

	for (const group of ranked) {
		if (tracked.length >= batchSize) {
			break;
		}

		members.push(...group.members);
		tracked.push(...group.candidates);
	}

	return {
		id: `batch-${String(batchNumber).padStart(2, '0')}:${scope}`,
		scope,
		files: tracked.sort((left, right) => left.statementsPct - right.statementsPct || left.path.localeCompare(right.path)),
		members,
	};
};
