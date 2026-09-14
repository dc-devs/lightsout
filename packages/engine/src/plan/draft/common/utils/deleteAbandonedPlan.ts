import { rm } from 'node:fs/promises';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';

/**
 * Delete the abandoned single draft before a phased re-draft, returning the
 * reason it could not be, if it could not.
 *
 * Not tidiness: `resolvePlanDeliverable` short-circuits on `plan.md` existing
 * and never looks for `overview.md` or the phase files when it does, so a
 * surviving single draft would shadow the phased plan entirely — grade, dedup
 * and implement would all read the abandoned file and never see the phases. Its
 * transcript stays in place under `draft-stream.jsonl` and the second overview
 * spawn writes its own, so the evidence of both attempts survives.
 *
 * Shared by both single-plan flows: the deliverable resolver both escalations
 * have to get past is one function, so the guard against it is one function too.
 *
 * @returns `undefined` once the path is gone, and otherwise the reason it is not.
 */
export const deleteAbandonedPlan = async ({ path }: { path: string }): Promise<string | undefined> => {
	await rm(path, { force: true }).catch(() => undefined);

	return (await pathExists({ path })) ? `the abandoned single draft could not be deleted at ${path}` : undefined;
};
