interface Params {
	/** Exact self-lint command the writer runs before reporting. Absent = prose self-review only, and no section is emitted. */
	lintCommand: string | undefined;
	/** Exact engine-section sync command, run ahead of the lint. Absent = this spawn was granted none, and the section names the lint alone. */
	syncCommand: string | undefined;
}

/**
 * The writer's self-lint brief: the commands it runs before reporting, in the
 * order it must run them, and the rule that stops the fix loop.
 *
 * The sync command is named first where it was granted, because it composes the
 * sections the writer is forbidden to write — a lint run ahead of it reports
 * defects the writer is not allowed to fix.
 *
 * @returns the section, or undefined when this spawn was granted no lint command.
 */
export const selfLintSection = ({ lintCommand, syncCommand }: Params): string | undefined => {
	if (lintCommand === undefined) {
		return undefined;
	}

	const sync =
		syncCommand === undefined
			? ''
			: `\`${syncCommand}\`

It composes every engine-owned section — the \`## Decision Log\` and the \`## Global Constraints\` from the same decision records you were handed, and the pairing of each \`## Phases\` row with its declaration heading on an overview — in every plan file of this plan. Those sections are not yours to write, and composing them first is what keeps the lint below from reporting them against you. Then run:

`;

	return `## Self-lint

After writing the plan file(s) and before reporting, run:

${sync}\`${lintCommand}\`

It prints structural findings and exits 1 while any remain, 0 when clean. Fix each finding in the plan file(s) and re-run until it exits 0. If a re-run reports the identical findings twice, stop and report anyway. If the command itself cannot be executed (denied tool, sandbox), skip it — the checklist self-review still applies and the engine re-lints your output either way.`;
};
