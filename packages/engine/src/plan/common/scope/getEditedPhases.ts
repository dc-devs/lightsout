import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { GradeInputs } from '#src/contracts/index.ts';

interface Params {
	current: GradeInputs;
	previous: GradeInputs;
}

type PlanFileEntry = GradeInputs['planFiles'][number];

/** Each fingerprint's plan-file entries, keyed by basename, so a file present on one side and not the other reads as changed rather than as missing. */
const hashesOf = ({ inputs }: { inputs: GradeInputs }) => new Map(inputs.planFiles.map((entry) => [entry.file, entry]));

/**
 * Whether the DESIGN a reader read moved — the plan file's text with every
 * engine-generated region removed and the overview text credited to it hashed
 * in, so a sync that rewrote only generated content is not reported as an edit.
 *
 * An absent design hash on EITHER side always counts as moved, the same rule
 * this file applies to an unread git probe and for the same reason: a
 * fingerprint recorded before design hashes existed measured no design at all,
 * which is not evidence that the design is unchanged.
 */
const designMoved = ({ current, previous }: { current?: PlanFileEntry; previous?: PlanFileEntry }) =>
	current?.designSha256 === undefined || previous?.designSha256 === undefined || current.designSha256 !== previous.designSha256;

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
 * the overview's WHOLE-FILE answer is handed to `getDecisionReach`, which tells a
 * generated Decision Log change from a design change, and any other input moving
 * means the recorded review no longer speaks for the current pass at all. The overview arriving in `edited` would send the closure
 * walk looking for a phase named `overview.md`; an unchanged phase arriving
 * there would widen a focused pass back to the whole plan.
 *
 * `edited` is computed on each plan file's design hash and
 * `overviewFileChanged` on the overview's whole-file hash, because they are two
 * different facts: the overview's design move is the one `getDecisionReach`
 * reads off its own part, while a per-phase span of the overview moving now
 * shows up as that phase being edited.
 */
export const getEditedPhases = ({ current, previous }: Params): { edited: string[]; overviewFileChanged: boolean; otherInputChanged: boolean } => {
	// the overview is every phase's context, so a change to it can reach any of them
	const overviewBase = 'overview.md';
	const currentHashes = hashesOf({ inputs: current });
	const previousHashes = hashesOf({ inputs: previous });
	const edited: string[] = [];
	let overviewFileChanged = false;

	for (const file of [...new Set([...currentHashes.keys(), ...previousHashes.keys()])].sort()) {
		const currentEntry = currentHashes.get(file);
		const previousEntry = previousHashes.get(file);

		if (file === overviewBase) {
			overviewFileChanged = currentEntry?.sha256 !== previousEntry?.sha256;
		} else if (designMoved({ current: currentEntry, previous: previousEntry })) {
			edited.push(file);
		}
	}

	return { edited, overviewFileChanged, otherInputChanged: otherInputMoved({ current, previous }) };
};
