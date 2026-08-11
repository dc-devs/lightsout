import { DecisionsRecord } from '@/contracts';
import { readPlanWorkspaceFile } from '@/plan/common/utils/readPlanWorkspaceFile';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
}

/**
 * Read and validate a plan workspace's `decisions.json` — the session-authored
 * Decision-Log record `plan draft` builds from. Boundary validation
 * (parse-don't-cast): a missing or corrupt file is a hard error, because
 * drafting a plan from decisions that were never authored would silently produce
 * a bad plan.
 */
export const readDecisions = async ({ cwd, name }: Params): Promise<DecisionsRecord> => {
	return readPlanWorkspaceFile({
		cwd,
		name,
		fileName: 'decisions.json',
		schema: DecisionsRecord,
		notFound: (filePath) => `no decisions found for plan ${name} at ${filePath} — author decisions.json before drafting`,
	});
};
