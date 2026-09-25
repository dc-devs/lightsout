import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listRunLocations } from '#src/runState/internal/common/paths/listRunLocations.ts';
import { RunNotFoundError } from '#src/runState/RunNotFoundError.ts';

/** Every run directory under the locations this repository files runs in, keyed by run id. */
const scanLocations = async ({ cwd }: { cwd: string }) => {
	const found = new Map<string, string>();

	for (const location of await listRunLocations({ cwd })) {
		const entries = await readdir(location, { withFileTypes: true }).catch(() => []);

		for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
			found.set(entry.name, join(location, entry.name));
		}
	}

	return found;
};

/**
 * The runs a typed id names. An exact id is an answer in its own right, never a
 * prefix of a longer one — reports print ids cut to eight characters, so a
 * prefix has to be accepted, and a run whose whole id is another's prefix must
 * still answer for itself.
 */
const matchRuns = ({ known, runId }: { known: ReadonlyMap<string, string>; runId: string }) => {
	const exact = known.get(runId);

	return exact === undefined
		? [...known].filter(([candidate]) => candidate.startsWith(runId)).map(([candidate, runDir]) => ({ runId: candidate, runDir }))
		: [{ runId, runDir: exact }];
};

/**
 * The run-id-to-directory map the engine keeps for the life of the process.
 *
 * A run's folder is filed under the work it belongs to, so nothing can be
 * joined onto a fixed path to find one — and the engine's most common operation
 * must not walk the tree on every manifest read. The structure stays the only
 * index; this is the memory of what it said.
 *
 * The scan is keyed by `cwd` rather than by the state directory it reads. Two
 * checkouts of one repository therefore keep one entry each and scan the same
 * folders, which costs one extra scan per distinct `cwd` and can never make
 * them disagree; keying by the state directory would instead make every lookup
 * pay a `git rev-parse` to find the key, which is the cost this index exists to
 * remove.
 */
export class RunDirectoryIndex {
	/** One run-id-to-directory map per `cwd` — filled by its first scan, and added to as runs are created. */
	private readonly directories = new Map<string, Map<string, string>>();
	private readonly scanned = new Set<string>();

	/**
	 * Which run a typed id names, and where it is — both from one lookup, so the
	 * two questions can never be answered from two different scans.
	 *
	 * @throws {RunNotFoundError} When nothing matches the id, or when a shortened id matches more than one run — which names the matches.
	 */
	async resolve({ cwd, runId }: { cwd: string; runId: string }): Promise<{ runId: string; runDir: string }> {
		let matches = matchRuns({ known: await this.load({ cwd }), runId });

		// A miss can mean the run was created after the scan — a queue coordinator
		// creates runs throughout its life, and a cache that never refreshed would
		// report the children it just made as missing. An ambiguous answer is never
		// re-read: a scan can only add ids, so it can never turn two into one.
		if (matches.length === 0) {
			matches = matchRuns({ known: await this.rescan({ cwd }), runId });
		}

		if (matches.length === 0) {
			throw new RunNotFoundError(`no run matching '${runId}' — list the runs this repo has with: lightsout status`);
		}

		if (matches.length > 1) {
			throw new RunNotFoundError(`run id '${runId}' matches ${matches.length} runs (${matches.map((match) => match.runId).join(', ')}) — pass more of the id`);
		}

		return matches[0];
	}

	/** Remember a directory as it is created, so the run answers to its own id before anything is written into it. */
	record({ cwd, runId, runDir }: { cwd: string; runId: string; runDir: string }): void {
		this.entriesFor({ cwd }).set(runId, runDir);
	}

	private entriesFor({ cwd }: { cwd: string }) {
		const standing = this.directories.get(cwd);

		if (standing !== undefined) {
			return standing;
		}

		const fresh = new Map<string, string>();

		this.directories.set(cwd, fresh);

		return fresh;
	}

	private async load({ cwd }: { cwd: string }) {
		return this.scanned.has(cwd) ? this.entriesFor({ cwd }) : this.rescan({ cwd });
	}

	private async rescan({ cwd }: { cwd: string }) {
		const entries = this.entriesFor({ cwd });

		for (const [runId, runDir] of await scanLocations({ cwd })) {
			entries.set(runId, runDir);
		}

		this.scanned.add(cwd);

		return entries;
	}
}
