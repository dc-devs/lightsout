interface Params {
	title: string;
	/** Paths the plan claims to create — one `### ` heading each. */
	creates: string[];
}

/** A plan body whose Files to Create names each given path — the minimum the prior-art detector reads. */
export const minimalPlanBody = ({ title, creates }: Params): string =>
	`# ${title}\n\n## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`;
