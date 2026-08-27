/**
 * Runs a script's entry point and turns a thrown error into a failing exit
 * code.
 *
 * Exit codes are set rather than forced with `process.exit`, for the reason
 * checkShipped.mjs states: stdout is a pipe for every caller that matters, and
 * exiting on the line after a log discards it.
 *
 * The scripts that write the sprawl artefacts share this rather than each
 * carrying its own copy — the handling is the same three lines every time, and
 * one copy is the only way a change to it reaches both.
 *
 * @param run - the script's entry point, called with no arguments
 */
export const runScript = ({ run }) => {
	try {
		run();
	} catch (error) {
		console.error(`  ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
};
