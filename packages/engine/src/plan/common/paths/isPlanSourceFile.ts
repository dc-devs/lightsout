import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';

interface Params {
	path: string;
}

/**
 * Whether a path counts toward a plan's size numbers: not a test, not a barrel,
 * not a declaration file.
 *
 * Lifted out of `lintPlanStructure`, where it was a non-exported local, because
 * three places must agree on it exactly — the two size checks, the count stamp
 * that writes the overview's declared numbers, and the plan template's wording
 * telling the drafter what to count. A second spelling of this predicate is a
 * second answer to "how big is this phase", which is the question the whole
 * guardrail turns on.
 *
 * A type-only module is NOT excluded: only `.d.ts` is, because a hand-authored
 * `Foo.ts` exporting one interface still has to be specified and written. The
 * template says exactly this, in these words, so the drafter counts what the
 * lint counts.
 */
export const isPlanSourceFile = ({ path }: Params): boolean => !isTestFile({ path }) && !/(^|\/)index\.[jt]sx?$/.test(path) && !/\.d\.ts$/.test(path);
