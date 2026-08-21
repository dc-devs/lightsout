import type { StandardsCheckInput } from '@lightsout/standards-contracts';

interface Params {
	/** Whatever the engine built for this run — only a test-file input carries test text. */
	input: StandardsCheckInput;
}

/**
 * The test files a check was handed, as path-and-text pairs.
 *
 * Every rule that declares the `test-file` input reads them, and every one
 * receives the whole input union, so narrowing on the discriminant is written
 * once here rather than as a cast per rule. An input of any other kind yields nothing: a
 * rule that declared `test-file` is never handed one, so refusing loudly would
 * describe a situation that cannot arise.
 */
export const readTestFiles = ({ input }: Params): Array<{ file: string; text: string }> =>
	input.kind === 'test-file' ? [...input.contents].map(([file, text]) => ({ file, text })) : [];
