import type { GradeInputs } from '#src/contracts/index.ts';

interface Params {
	/** The fingerprint the hashes are read off — this pass's own. */
	inputs: GradeInputs;
}

/**
 * Each plan file's design hash now, keyed by basename, the overview included —
 * the text one recorded reading is written at and later compared against.
 *
 * A file the fingerprint could not measure is simply absent rather than given a
 * placeholder: absent never compares equal to a recorded entry, so an unmeasured
 * file falls out of coverage instead of quietly standing.
 */
export const getDesignHashes = ({ inputs }: Params): Map<string, string> =>
	new Map(inputs.planFiles.flatMap(({ file, designSha256 }) => (designSha256 === undefined ? [] : [[file, designSha256] as const])));
