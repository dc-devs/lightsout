import type { BrainstormDecisions, DecisionsRecord } from '#src/contracts/index.ts';
import { readBrainstormDecisions } from '#src/plan/readBrainstormDecisions.ts';
import { readDecisions } from '#src/plan/readDecisions.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Optional progress line; the sync command and the read-only passes pass none. */
	onProgress?: (message: string) => void;
}

/**
 * The plan's decision rows as one record, with brainstorm's settled ones first:
 * they were settled first, and that order is both the order the Decision Log
 * renders in and the order supersession resolves against. Brainstorm rows are
 * merged at read time so the plan's own `decisions.json` stays plan-owned.
 *
 * A missing `decisions.json` is left to reject as `readDecisions` raises it —
 * the caller decides whether that is a thrown error or a failed result.
 */
export const readMergedDecisions = async ({
	cwd,
	name,
	onProgress,
}: Params): Promise<{ merged: DecisionsRecord; brainstorm: BrainstormDecisions | undefined }> => {
	const decisions = await readDecisions({ cwd, name });
	const brainstorm = await readBrainstormDecisions({ cwd, name });
	const merged: DecisionsRecord = brainstorm ? { ...decisions, decisions: [...brainstorm.decisions, ...decisions.decisions] } : decisions;

	onProgress?.(
		brainstorm
			? `plan draft ${name}: ${brainstorm.decisions.length} brainstorm decision(s) carried in`
			: `plan draft ${name}: no brainstorm decisions — drafting from the plan's own rows`,
	);

	return { merged, brainstorm };
};
