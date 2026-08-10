import { cpSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the shipped standards package from the authored one.
 *
 * `standards/` at the repo root is the source of truth — the folder authors
 * edit and reviewers read. `plugin/standards/` is what ships, because
 * marketplace installs copy only the plugin directory, so anything that must
 * exist beside the running engine has to live inside it. Like
 * `plugin/dist/cli.mjs`, the built package is committed: there is no install
 * hook that could produce it later.
 *
 * What is left out is what only proves the package rather than running it —
 * every rule's fixture pair and the co-located unit tests, together about
 * seventy percent of the source by both count and size. The engine loads a
 * package without them; `lightsout standards-validate` is what demands the
 * pair, and it runs here against `standards/`, where the evidence lives.
 *
 * The destination is removed before writing rather than written over, so a
 * rule deleted from the source disappears from the shipped package instead of
 * lingering as a file nothing regenerates.
 *
 * Never edit `plugin/standards/` by hand — the next bundle discards it.
 *
 * `--out <dir>` builds somewhere else instead. That exists for the pre-push
 * hook, which has to answer "would this build differ from what is committed?"
 * without writing into the tree it is asking about — a check that repairs what
 * it measures would report success and leave the fix uncommitted.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'standards');
const outFlag = process.argv.indexOf('--out');

/** True for the evidence a shipped package does not carry: fixture trees and unit tests. */
const isAuthoringOnly = (path) => path.split(sep).includes('fixtures') || path.endsWith('.unit.test.ts');

// The exit code is set rather than forced with `process.exit`: stdout is a pipe
// for every caller that matters, writes to a pipe are asynchronous, and exiting
// on the line after a log discards it.
if (outFlag !== -1 && process.argv[outFlag + 1] === undefined) {
	console.error('--out needs a directory');
	process.exitCode = 1;
} else {
	const destination = outFlag === -1 ? join(repoRoot, 'plugin', 'standards') : resolve(process.argv[outFlag + 1]);

	rmSync(destination, { recursive: true, force: true });
	cpSync(source, destination, { recursive: true, filter: (from) => !isAuthoringOnly(from) });

	console.log(`built standards → ${destination.replace(`${repoRoot}${sep}`, '')}`);
}
