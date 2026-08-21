import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { readTestFiles } from '../checkInput/readTestFiles.ts';
import { buildHookFinding } from '../findings/buildHookFinding.ts';
import { readCallBlocks } from '../parsing/readCallBlocks.ts';

interface Params {
	/** The rule asking — it names the finding's site key. */
	rule: string;
	/** The hooks this rule reads, named because the prose names them — a rule about `beforeEach` must not judge an `afterEach`. */
	hooks: string[];
	/** What marks a hook body as violating. Must not be a global regex — `test` on one would skip every other block. */
	pattern: RegExp;
	/** Completes the sentence after `beforeEach at line 6`, e.g. `asserts`. */
	detailSuffix: string;
	guidance: string;
}

/**
 * A whole check for a rule that reads test files and reports on what sits
 * inside a hook.
 *
 * `buildHookFinding` already holds the judging of one file's blocks. This
 * holds the rest of the check around it — the input it declares, the read, and
 * the walk across files — so the three rules using it share a body instead of
 * repeating one. Each states only which hooks it reads, what it looks for, and
 * what it says.
 */
export const buildHookContentCheck = ({ rule, hooks, pattern, detailSuffix, guidance }: Params): StandardsCheckModule => ({
	inputKind: 'test-file',
	run: ({ input }) =>
		readTestFiles({ input }).flatMap(({ file, text }) =>
			buildHookFinding({ rule, file, blocks: readCallBlocks({ text, callees: hooks }), pattern, detailSuffix, guidance }),
		),
});
