/**
 * Compares by numeric segment. True only when `head` is genuinely newer, so a
 * version that moved backwards fails too.
 *
 * One comparison for both callers: `preShip.mjs` decides the bump with it and
 * `checkShipped.mjs` decides pass or fail with it, and the hook calls the check
 * in the same run — so two statements of the rule that disagreed about a
 * segment would let preparation write a version the check it then calls
 * refuses.
 *
 * @param head - the version the working tree carries
 * @param base - the version the base commit carries
 */
export const isNewer = ({ head, base }) => {
	const segments = ({ version }) => version.split('.').map((segment) => Number.parseInt(segment, 10) || 0);
	const [headSegments, baseSegments] = [segments({ version: head }), segments({ version: base })];
	let verdict = false;

	for (let index = 0; index < Math.max(headSegments.length, baseSegments.length); index += 1) {
		const [left, right] = [headSegments[index] ?? 0, baseSegments[index] ?? 0];

		if (left !== right) {
			verdict = left > right;
			break;
		}
	}

	return verdict;
};
