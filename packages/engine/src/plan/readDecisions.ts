import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DecisionsRecord } from '@lightsout/contracts';
import { planWorkspaceDir } from './planWorkspaceDir';

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
	const decisionsPath = join(planWorkspaceDir({ cwd, name }), 'decisions.json');
	const raw = await readFile(decisionsPath, 'utf8').catch(() => {
		throw new Error(`no decisions found for plan ${name} at ${decisionsPath} — author decisions.json before drafting`);
	});

	return DecisionsRecord.parse(JSON.parse(raw));
};
