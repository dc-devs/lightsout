interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * The structural self-lint the plan writer runs in-session, as both the full
 * command and the prefix the harness is asked to allow.
 *
 * The writer lints where its context is already loaded — a repair spawn re-reads
 * everything it already knew. `process.argv[1]` is the running CLI bundle, so
 * the writer's subprocess resolves the identical engine rather than whatever
 * happens to be installed. The consumer-controlled `cwd` is quoted because it
 * may contain spaces; the prefix stays unquoted in both the command and the
 * grant, because the harness's allowed-tools rule is a literal prefix match.
 */
export const buildPlanLintCommand = ({ cwd, name }: Params): { prefix: string; command: string } => {
	const prefix = `node ${process.argv[1]} plan lint`;

	return { prefix, command: `${prefix} --name ${name} --cwd "${cwd}"` };
};
