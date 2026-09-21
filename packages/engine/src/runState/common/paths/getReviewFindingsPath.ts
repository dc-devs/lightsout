import { join } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
}

/**
 * One append-only judgment-review log per consumer repo, at the top of the
 * state directory the primary checkout holds:
 * `<primary>/.lightsout/review-findings.jsonl`.
 */
export const getReviewFindingsPath = async ({ cwd }: Params): Promise<string> => {
	return join(await resolveSharedStateDir({ cwd }), 'review-findings.jsonl');
};
