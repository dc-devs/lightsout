import { cpSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
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
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'standards');
const destination = join(repoRoot, 'plugin', 'standards');

/** True for the evidence a shipped package does not carry: fixture trees and unit tests. */
const isAuthoringOnly = (path) => path.split(sep).includes('fixtures') || path.endsWith('.unit.test.ts');

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true, filter: (from) => !isAuthoringOnly(from) });

console.log(`built standards → ${destination.replace(`${repoRoot}${sep}`, '')}`);
