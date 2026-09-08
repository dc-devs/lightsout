import { decisionLogReference, renderDecisionLog } from '#src/plan/index.ts';

interface Params {
	title: string;
	/** Paths the plan claims to create — one `### ` heading each. */
	creates: string[];
	/** Carry the Decision Log pointer instead of the rendered table — what a phase file of a phased deliverable holds. */
	reference?: boolean;
}

/** A plan body whose Files to Create names each given path — the minimum the prior-art detector reads, plus the Decision Log every plan file is checked for. */
export const minimalPlanBody = ({ title, creates, reference = false }: Params): string =>
	`# ${title}\n\n${reference ? decisionLogReference() : renderDecisionLog({ decisions: [] })}\n\n## Files to Create\n\n${creates
		.map((path) => `### \`${path}\`\n\nnew.\n`)
		.join('\n')}\n`;
