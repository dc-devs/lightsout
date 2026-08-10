interface Params {
	kind: string;
}

/**
 * A gate command that appends "<label> <kind>" to gates.log in the repo —
 * the label rides as the command's first argument (e.g. `... root` or
 * `... {package}`), making gate scoping observable in tests.
 */
export const gateLogCommand = ({ kind }: Params) => `node -e "require('fs').appendFileSync('gates.log', process.argv[1] + ' ${kind}\\n')"`;
