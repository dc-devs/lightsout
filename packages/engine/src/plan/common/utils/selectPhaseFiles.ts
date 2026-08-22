import { basename } from 'node:path';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';

interface Params {
	/** Every plan file the deliverable resolved to, in its own order. */
	files: DeliverableFile[];
	/** What a human passed to `--phase`; absent selects every file. */
	phases?: string[];
}

/** The phase index a `phase<N>-<slug>.md` basename carries; NaN for `plan.md` and anything else. */
const phaseIndexOf = ({ file }: { file: DeliverableFile }) => Number(/^phase(\d+)/.exec(basename(file.path))?.[1] ?? Number.NaN);

/**
 * Narrow the plan files a `--phase` grade gap-checks, or refuse.
 *
 * Each requested value must match exactly one plan file: a bare integer against
 * the phase index parsed out of `phase<N>-<slug>.md` — numerically, so `1`
 * selects `phase1-…` and never also `phase10-…` — or a full basename verbatim.
 * Extensionless stems are not accepted: one spelling per thing, and the basename
 * is what every finding and the coverage list already print.
 *
 * A value matching no plan file or more than one, and a request naming nothing
 * at all, is a hard failure listing what is available. A typo must never quietly
 * grade nothing and report it clean — which is the same defect, arrived at from
 * the other side, that the coverage statement exists to close.
 *
 * The selection comes back in the deliverable's own order, so a repeated or
 * out-of-order request still reads as one ordered pass over the plan.
 */
export const selectPhaseFiles = ({ files, phases }: Params): { selected: DeliverableFile[] } | { error: string } => {
	if (phases === undefined) {
		return { selected: files };
	}

	const listing = `available: ${files.map((file) => basename(file.path)).join(', ')}`;

	if (phases.length === 0) {
		return { error: `--phase named no phase file — ${listing}` };
	}

	const wanted = new Set<string>();

	for (const value of phases) {
		const matches = /^\d+$/.test(value)
			? files.filter((file) => phaseIndexOf({ file }) === Number(value))
			: files.filter((file) => basename(file.path) === value);

		if (matches.length !== 1) {
			return { error: `--phase ${value} matches ${matches.length} plan file(s) — ${listing}` };
		}

		wanted.add(matches[0].path);
	}

	return { selected: files.filter((file) => wanted.has(file.path)) };
};
