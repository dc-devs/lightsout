import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The run's gate-command ledger, entry by entry — empty when the run never wrote one. */
export const readCommandLog = (dir: string, runId: string): Record<string, unknown>[] => {
	try {
		return readFileSync(join(dir, '.lightsout', 'runs', runId, 'commands.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
};
