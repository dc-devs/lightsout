import { basename } from 'node:path';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';

interface Params {
	/** Every implementable plan file with its current text. */
	files: DeliverableFile[];
	overviewText?: string;
	/** The record's `phase` — a deliverable basename, `overview.md`, or a phase that no longer exists. */
	phase: string;
}

/**
 * The text one memory record is re-checked against: its own plan file when the
 * deliverable still holds it, and the whole rendered plan otherwise.
 *
 * The documentation checker stamps its findings with `overview.md` on a phased
 * plan, and a resplit can rename a phase file away. Either record names no
 * deliverable file, and one that could never be re-verified would block until a
 * human deleted the memory — the forgotten-blocker failure inverted.
 *
 * Spelled once because the re-verification judge's prompt and both citation
 * checks must read the same text: a quote accepted at closing time would
 * otherwise fail its re-check for no reason but rendering.
 */
export const recheckPlanText = ({ files, overviewText, phase }: Params): string => {
	const own = files.find((file) => basename(file.path) === phase);
	const rendered = files.map((file) => `## Plan file: ${basename(file.path)}\n\n${file.text}`);
	const wholePlan = [...(overviewText === undefined ? [] : [overviewText]), ...rendered].join('\n\n');

	return own?.text ?? wholePlan;
};
