import { basename } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { DecisionsRecord } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { resolvePlanDeliverable } from '#src/plan/common/utils/resolvePlanDeliverable.ts';
import type { SyncedPlanFile } from '#src/plan/decisionLog/common/types/SyncedPlanFile.ts';
import { decisionLogReference } from '#src/plan/decisionLog/decisionLogReference.ts';
import { readMergedDecisions } from '#src/plan/decisionLog/readMergedDecisions.ts';
import { renderDecisionLog } from '#src/plan/decisionLog/renderDecisionLog.ts';
import { writeDecisionLogSection } from '#src/plan/decisionLog/writeDecisionLogSection.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Already-merged rows; when absent they are read from the plan workspace. */
	decisions?: DecisionsRecord;
	/** Sync exactly these plan files instead of resolving the deliverable. The draft flow owns its own paths, and mid-draft the deliverable does not always resolve. */
	planPaths?: string[];
}

type SyncPlanDecisionsResult = { status: typeof PlanRunStatus.Complete; files: SyncedPlanFile[] } | { status: typeof PlanRunStatus.Failed; error: string };

/**
 * The plan's merged record, as a value rather than a rejection — a record nobody
 * authored is a failed sync, not a crash.
 *
 * The return type is annotated although this is an internal helper: inferred, it
 * normalizes to a union whose success member carries an optional `error`, and
 * the caller's narrowing then reads that field as possibly undefined.
 */
const resolveDecisions = async ({
	cwd,
	name,
	decisions,
}: {
	cwd: string;
	name: string;
	decisions?: DecisionsRecord;
}): Promise<{ record: DecisionsRecord } | { error: string }> => {
	if (decisions !== undefined) {
		return { record: decisions };
	}

	try {
		const { merged } = await readMergedDecisions({ cwd, name });

		return { record: merged };
	} catch (error) {
		return { error: messageOf({ error }) };
	}
};

/**
 * The plan files this sync rewrites: the caller's own list when it has one, and
 * every file of the resolved deliverable otherwise.
 *
 * The draft flow states its paths because mid-draft the deliverable does not
 * always resolve — between the overview spawn and the first phase file the
 * folder holds neither a `plan.md` nor a phase file, which
 * `resolvePlanDeliverable` reads as no plan at all.
 *
 * Annotated for the same reason `resolveDecisions` is: inferred, the union
 * normalizes to one member carrying an optional `error`, and the caller's
 * narrowing then reads that field as possibly undefined.
 */
const resolvePaths = async ({
	cwd,
	name,
	planPaths,
}: {
	cwd: string;
	name: string;
	planPaths?: string[];
}): Promise<{ paths: string[] } | { error: string }> => {
	if (planPaths !== undefined) {
		return { paths: planPaths };
	}

	const deliverable = await resolvePlanDeliverable({ cwd, name });

	if (deliverable.error !== undefined) {
		return { error: deliverable.error };
	}

	const isSinglePlan = deliverable.files.length === 1 && basename(deliverable.files[0]?.path ?? '') === 'plan.md';

	if (!isSinglePlan && deliverable.overviewPath === undefined) {
		return { error: `cannot sync decisions for '${name}': phase files need an overview.md to carry the Decision Log the phases point at` };
	}

	const overviewPaths = deliverable.overviewPath === undefined ? [] : [deliverable.overviewPath];

	return { paths: [...overviewPaths, ...deliverable.files.map((file) => file.path)] };
};

/**
 * Regenerate the `## Decision Log` of every file of one plan deliverable from
 * the saved decision records.
 *
 * `plan.md` and `overview.md` carry the rendered table; every
 * `phase<N>-<slug>.md` carries the sentence pointing at the overview's copy, so
 * a phased plan keeps one history rather than one per phase, and which of the
 * two a path gets is decided from its name in every case. What a plan *is* —
 * for a caller that does not state its own paths — is answered by
 * `resolvePlanDeliverable` and nowhere else.
 *
 * Every way this can fail — an unresolvable deliverable, phase files with no
 * overview to hold the table, a record that was never authored — is settled
 * before the first write, so a caller never has to reason about a half-synced
 * deliverable. Callers already holding the merged record pass it in, beside the
 * paths they own: the draft flow syncs mid-draft from the record it started
 * with, and a second read of the workspace there would be a second source of
 * truth.
 */
export const syncPlanDecisions = async ({ cwd, name, decisions, planPaths }: Params): Promise<SyncPlanDecisionsResult> => {
	const resolvedPaths = await resolvePaths({ cwd, name, planPaths });

	if ('error' in resolvedPaths) {
		return { status: PlanRunStatus.Failed, error: resolvedPaths.error };
	}

	const resolved = await resolveDecisions({ cwd, name, decisions });

	if ('error' in resolved) {
		return { status: PlanRunStatus.Failed, error: resolved.error };
	}

	const table = renderDecisionLog({ decisions: resolved.record.decisions });
	const reference = decisionLogReference();
	const files: SyncedPlanFile[] = [];

	for (const path of resolvedPaths.paths) {
		const base = basename(path);
		const section = base === 'plan.md' || base === 'overview.md' ? table : reference;

		files.push(await writeDecisionLogSection({ path, section }));
	}

	return { status: PlanRunStatus.Complete, files };
};
