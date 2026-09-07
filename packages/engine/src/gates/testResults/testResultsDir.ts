import { join } from 'node:path';
import { getRunDir } from '#src/runState/index.ts';

/**
 * A package group is a directory name and a custom gate kind is a config key,
 * so neither is guaranteed to be safe as a path segment.
 */
const unsafeSegmentCharacters = /[^A-Za-z0-9._-]/g;

const safeSegment = ({ segment }: { segment: string }) => segment.replace(unsafeSegmentCharacters, '-');

interface Params {
	cwd: string;
	runId: string;
	/** The pipeline step in flight. */
	step: string;
	/** 'root' or the package directory name. */
	group: string;
	/** The gate family, as `GateResult.kind` records it. */
	kind: string;
}

/**
 * The absolute directory one gate execution's per-test results go in, keyed by
 * the step, the package group and the gate kind.
 *
 * One directory per execution rather than one file per run: a checkpoint has to
 * be able to read exactly the evidence the gate it observed wrote, and never a
 * sibling gate's or an earlier attempt's.
 */
export const testResultsDir = ({ cwd, runId, step, group, kind }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'test-results', safeSegment({ segment: step }), safeSegment({ segment: group }), safeSegment({ segment: kind }));
};
