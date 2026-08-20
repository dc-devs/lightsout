import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the shipped standards package from the authored one.
 *
 * `packages/standards-typescript/` is the source of truth — the folder
 * authors edit and reviewers read. `plugin/standards/` is what ships, because
 * marketplace installs copy only the plugin directory, so anything that must
 * exist beside the running engine has to live inside it. Like
 * `plugin/dist/cli.mjs`, the built package is committed: there is no install
 * hook that could produce it later.
 *
 * What is left out is what only proves the package rather than running it —
 * every rule's fixture pair and the co-located unit tests, together about
 * seventy percent of the source by both count and size. The engine loads a
 * package without them; `lightsout standards-validate` is what demands the
 * pair, and it runs against the authored package, where the evidence lives.
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
const source = join(repoRoot, 'packages', 'standards-typescript');
const outFlag = process.argv.indexOf('--out');

/**
 * What the authored folder holds so that it can be developed, which a shipped
 * package neither needs nor should carry: the workspace manifest and its
 * installed dependencies, the type and test configuration, the notes for whoever
 * edits it, and anything a tool has written there.
 *
 * Matched against the package root only, so a rule that legitimately owned a
 * file of one of these names deeper in the tree still ships.
 *
 * `coverage` earns its place the hard way: it appears only after someone runs
 * the package's tests with coverage on, so a build made on a clean checkout is
 * correct and the same build on a working machine quietly gains a few hundred
 * files of HTML. Worse, the shipped-artifact check compares a fresh build
 * against the committed copy — both would carry it, and both would agree.
 */
const authoringFiles = new Set(['node_modules', 'coverage', 'package.json', 'tsconfig.json', 'tsconfig.jest.json', 'jest.config.cjs', 'README.md']);

/** True for what only proves or develops the package rather than running it. */
const isAuthoringOnly = (path) => {
	const relativePath = relative(source, path);

	return relativePath.split(sep).includes('fixtures') || path.endsWith('.unit.test.ts') || authoringFiles.has(relativePath);
};

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

	// Written rather than copied. The shipped package declares its own module
	// format so its check files load as ES modules wherever they are unpacked —
	// a marketplace install has no manifest above them to inherit one from. The
	// authored package.json is left behind because it names workspace
	// dependencies that will not exist on a user's machine.
	writeFileSync(join(destination, 'package.json'), '{\n\t"type": "module"\n}\n');

	// Rewritten rather than copied, to stamp `built`. Everything above strips the
	// evidence a package is validated against, and the package saying so is what
	// lets `lightsout standards-validate` report one fact about the artifact
	// instead of reading every stripped fixture as a rule its author forgot.
	const root = JSON.parse(readFileSync(join(source, 'lightsout-standards.json'), 'utf8'));

	writeFileSync(join(destination, 'lightsout-standards.json'), `${JSON.stringify({ ...root, built: true }, null, '\t')}\n`);

	console.log(`built standards → ${destination.replace(`${repoRoot}${sep}`, '')}`);
}
