import { z } from 'zod';
import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';

interface Params {
	/** One decoded row of `--json number,url,title,headRefName`, or nothing at all when the forge returned no rows. */
	row: unknown;
}

/** The four fields both readers ask `gh` for, as they must arrive for a summary to be built. */
const PullRequestRow = z.object({ number: z.number(), url: z.string(), title: z.string(), headRefName: z.string() });

/**
 * A decoded `gh` row as a `PullRequestSummary`, or undefined when it is not one.
 *
 * Both readers in this folder ask for the same four fields and both must refuse
 * a row missing any of them: a summary carrying an undefined number would reach
 * the merge step as `gh pr merge undefined`. Parsed rather than cast, because
 * this is the boundary where the forge's word becomes the engine's type.
 */
export const toPullRequestSummary = ({ row }: Params): PullRequestSummary | undefined => {
	const parsed = PullRequestRow.safeParse(row);

	return parsed.success ? { number: parsed.data.number, url: parsed.data.url, title: parsed.data.title, branch: parsed.data.headRefName } : undefined;
};
