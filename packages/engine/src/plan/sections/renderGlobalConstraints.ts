import type { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';

interface Params {
	/** The merged rows, brainstorm first, in record order. */
	decisions: DecisionRow[];
}

/**
 * One authored choice as a bullet: trimmed, and its line breaks folded so one
 * constraint stays one bullet. A break left in would read as a second rule
 * nobody settled.
 */
const toBullet = ({ text }: { text: string }) => text.trim().replace(/\r?\n/g, ' ');

/**
 * The live row for each constraint question, in record order. Two rows carrying
 * one question are a rule and its revision, and only the later one binds — the
 * same precedence `renderDecisionLog` computes for its supersession markers.
 */
const liveConstraints = ({ decisions }: { decisions: DecisionRow[] }) => {
	// The prefix that marks a settled decision as a rule binding the whole plan —
	// the same test `getGradeInputs` applies when it decides a row's reach.
	const constraints = decisions.filter((row) => row.question.startsWith('Global constraint:'));
	const binding = new Map<string, number>();

	for (const [index, row] of constraints.entries()) {
		binding.set(row.question, index);
	}

	return constraints.filter((row, index) => binding.get(row.question) === index);
};

/**
 * The plan's `## Global Constraints` section, rendered from the merged decision
 * record — heading line included, no trailing newline, because the section
 * writer owns how the section joins the file around it.
 *
 * Pure and synchronous for the same reason `renderDecisionLog` is: a re-render
 * is what decides whether a file's section is stale, and a renderer that read a
 * clock, a config or the disk would report a difference nobody made.
 *
 * A record stating no constraint still renders one bullet saying so, because a
 * section with an empty body is one a reader cannot act on.
 */
export const renderGlobalConstraints = ({ decisions }: Params): string => {
	const note = "Composed from this plan's saved decision records — every `Global constraint:` row. Do not edit by hand.";
	const live = liveConstraints({ decisions });
	const bullets = live.length === 0 ? ['- None'] : live.map((row) => `- ${toBullet({ text: row.choice })}`);

	return `## Global Constraints\n\n${note}\n\n${bullets.join('\n')}`;
};
