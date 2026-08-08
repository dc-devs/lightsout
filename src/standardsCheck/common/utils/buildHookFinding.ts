import type { StandardsFinding, StandardsRule } from '@/contracts';
import type { CallBlock } from '@/standardsCheck/common/types/CallBlock';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { buildLineSites } from '@/standardsCheck/common/utils/buildLineSites';

interface Params {
	/** Repo-relative test file path — the finding's site. */
	file: string;
	/** The hook blocks to judge — pass `beforeEach` alone for a rule whose doc line names only that hook. */
	blocks: CallBlock[];
	rule: StandardsRule;
	/** What marks a hook body as violating. Must not be a global regex — `test` on one would skip every other block. */
	pattern: RegExp;
	/** Completes the sentence after `beforeEach at line 6`, e.g. `asserts`. */
	detailSuffix: string;
	guidance: string;
}

/**
 * A finding for every hook block whose body matches `pattern`, or `undefined`
 * when none does.
 *
 * Three rules of standards/tests/unit/jest/unit-testing.md differ only in which
 * hooks they read, what they look for, and what they say — a return value set in
 * a hook, an assertion in a hook, and mock cleanup the Jest config already does.
 * Written out per rule they are the same twelve lines three times, which is
 * exactly the shape the clone detector reports.
 *
 * A module internal — its behaviour is pinned through `checkTestShape`, the
 * public surface the three rules reach a caller through.
 */
export const buildHookFinding = ({ file, blocks, rule, pattern, detailSuffix, guidance }: Params): StandardsFinding | undefined => {
	const hooks = blocks.filter((block) => pattern.test(block.body));

	return hooks.length === 0
		? undefined
		: buildFinding({
				rule,
				files: buildLineSites({ file, spans: hooks }),
				detail: `${hooks.map((block) => `${block.callee} at line ${block.startLine}`).join(', ')} ${detailSuffix}`,
				guidance,
			});
};
