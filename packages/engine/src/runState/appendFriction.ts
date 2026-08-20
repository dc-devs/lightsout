import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type FrictionEntry, FrictionRecord } from '#src/contracts/index.ts';
import { getFrictionPath } from '#src/runState/common/paths/getFrictionPath.ts';

interface Params {
	cwd: string;
	runId: string;
	step: string;
	friction: FrictionEntry[];
}

/**
 * Persist friction entries to `.lightsout/friction.jsonl` in the target repo
 * (one JSON line per record, with provenance). Append-only: friction
 * accumulates across runs — that's what lets the improvement loop see
 * systemic patterns instead of one-offs.
 */
export const appendFriction = async ({ cwd, runId, step, friction }: Params): Promise<void> => {
	if (friction.length === 0) {
		return;
	}

	const at = new Date().toISOString();
	const lines = friction.map((entry) => JSON.stringify(FrictionRecord.parse({ ...entry, at, runId, step }))).join('\n');

	const path = getFrictionPath({ cwd });

	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${lines}\n`, 'utf8');
};
