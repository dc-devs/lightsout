interface Params {
	/** The exact command the engine granted this spawn. Absent = this spawn has no self-check and no section is emitted. */
	command: string | undefined;
}

/**
 * The per-spawn brief for the engine's own self-check: the command verbatim,
 * what its exit codes mean, and the rules that keep the loop terminating.
 *
 * One text, shared by the three invocation builders that may emit it, because
 * the rules bind all three identically. A spawn the engine granted no
 * self-check is told nothing about one.
 *
 * @returns the section, or undefined when this spawn was granted no command.
 */
export const selfCheckSection = ({ command }: Params): string | undefined => {
	if (command === undefined) {
		return undefined;
	}

	return [
		'# Engine self-check',
		'',
		'Before you report, run this command — the engine granted it to this spawn:',
		'',
		`\`${command}\``,
		'',
		"It is the engine's own command, not the repository's, and it takes no arguments beyond the ones already written above — appending one only makes the invocation fail. It runs the cheap gates the engine's next checkpoint will run, narrowed to what your change touched. It exits 1 when a gate it ran went red, and exits 0 when every gate it ran passed.",
		'',
		'- Fix what it prints and re-run it until it is clean.',
		'- Stop when a re-run reports the identical findings, and never run it more than three times in one spawn.',
		'- Repair only what is traceable to a file you changed yourself. The check is scoped to a package rather than to your diff, so it can print a red your change did not cause — put every such finding straight into your report and do not re-run for it.',
		'- If the command itself cannot be executed, skip it. If it reports that it could not work out what to check, or that it ran nothing, record that and move on — do not re-run it.',
		"- Report exactly as you would have anyway. A self-check still red when you stop belongs in your report's `friction` array, never turning a complete report into a failed one.",
		'',
		"Nothing this command prints decides whether your step passed: the engine's gates run afterwards over the full scope and are the only verdict.",
	].join('\n');
};
