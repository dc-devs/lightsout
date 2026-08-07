import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FrictionRecord, type FrictionEntry } from '@/contracts';

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
export const appendFriction = async ({ cwd, runId, step, friction }: Params) => {
	if (friction.length === 0) {
		return;
	}

	const at = new Date().toISOString();
	const lines = friction
		.map((entry) => JSON.stringify(FrictionRecord.parse({ ...entry, at, runId, step })))
		.join('\n');

	await mkdir(join(cwd, '.lightsout'), { recursive: true });
	await appendFile(join(cwd, '.lightsout', 'friction.jsonl'), `${lines}\n`, 'utf8');
};
