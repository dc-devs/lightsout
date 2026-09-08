interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * The Decision Log sync as both the full command and the prefix the harness is
 * asked to allow.
 *
 * `process.argv[1]` is the running CLI bundle, so an agent's subprocess resolves
 * the identical engine rather than whatever happens to be installed. The
 * consumer-controlled `cwd` is quoted because it may contain spaces; the prefix
 * stays unquoted in both the command and the grant, because the harness's
 * allowed-tools rule is a literal prefix match.
 */
export const buildPlanSyncDecisionsCommand = ({ cwd, name }: Params): { prefix: string; command: string } => {
	const prefix = `node ${process.argv[1]} plan sync-decisions`;

	return { prefix, command: `${prefix} --name ${name} --cwd "${cwd}"` };
};
