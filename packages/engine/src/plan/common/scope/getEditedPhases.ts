import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { GradeInputs } from '#src/contracts/index.ts';

interface Params {
	current: GradeInputs;
	previous: GradeInputs;
}

/** Each fingerprint's plan-file hashes, keyed by basename, so a file present on one side and not the other reads as changed rather than as missing. */
const hashesOf = ({ inputs }: { inputs: GradeInputs }) => new Map(inputs.planFiles.map((entry) => [entry.file, entry.sha256]));

/**
 * Whether anything that is not plan text moved between the two passes.
 *
 * An absent `changedFiles` or `gradedCommit` on EITHER side always counts as
 * differing: an unread probe is not evidence the code is unchanged, and reading
 * it as clean would let a focused pass narrow against a code state nobody
 * measured.
 */
const otherInputMoved = ({ current, previous }: Params) =>
	current.changedFiles === undefined ||
	previous.changedFiles === undefined ||
	current.gradedCommit === undefined ||
	previous.gradedCommit === undefined ||
	current.gradedCommit !== previous.gradedCommit ||
	canonicalJson({ value: current.changedFiles }) !== canonicalJson({ value: previous.changedFiles }) ||
	current.standards !== previous.standards ||
	current.config !== previous.config ||
	current.prompts !== previous.prompts ||
	current.model !== previous.model ||
	current.effort !== previous.effort;

/**
 * What moved between two passes, told apart by what each kind of change can
 * reach.
 *
 * The three answers are separate because the scope rule treats them
 * differently: an edited phase is the seed of the closure a focused pass reads,
 * the overview's whole-file answer is handed to `getDecisionReach`, which tells a
 * generated Decision Log change from a design change, and any other input moving
 * means the recorded review no longer speaks for the current pass at all. The overview arriving in `edited` would send the closure
 * walk looking for a phase named `overview.md`; an unchanged phase arriving
 * there would widen a focused pass back to the whole plan.
 */
export const getEditedPhases = ({ current, previous }: Params): { edited: string[]; overviewChanged: boolean; otherInputChanged: boolean } => {
	// the overview is every phase's context, so a change to it can reach any of them
	const overviewFile = 'overview.md';
	const currentHashes = hashesOf({ inputs: current });
	const previousHashes = hashesOf({ inputs: previous });
	const edited: string[] = [];
	let overviewChanged = false;

	for (const file of [...new Set([...currentHashes.keys(), ...previousHashes.keys()])].sort()) {
		const moved = currentHashes.get(file) !== previousHashes.get(file);

		if (file === overviewFile) {
			overviewChanged = moved;
		} else if (moved) {
			edited.push(file);
		}
	}

	return { edited, overviewChanged, otherInputChanged: otherInputMoved({ current, previous }) };
};
