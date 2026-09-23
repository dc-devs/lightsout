import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Directory names, or nothing when the folder is not there — a location a repo has never used is not an error. */
const childFolders = ({ path }: { path: string }) => {
	try {
		return readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
};

/** Every runs folder this repo could be filing a run in — one per ticket, plus one per command. */
const runsFolders = ({ dir }: { dir: string }) => {
	const stateDir = join(dir, '.lightsout');

	return [
		...childFolders({ path: join(stateDir, 'work-orders') }).map((ticket) => join(stateDir, 'work-orders', ticket, 'runs')),
		...['implement', 'direct', 'refactor', 'coverage', 'queue'].map((command) => join(stateDir, command, 'runs')),
	];
};

/** The run's gate-command ledger, entry by entry — empty when the run never wrote one. */
export const readCommandLog = (dir: string, runId: string): Record<string, unknown>[] => {
	let records: Record<string, unknown>[] = [];

	for (const folder of runsFolders({ dir })) {
		try {
			records = readFileSync(join(folder, runId, 'commands.jsonl'), 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			break;
		} catch {
			// The run is filed somewhere else, or it wrote no ledger at all.
		}
	}

	return records;
};
