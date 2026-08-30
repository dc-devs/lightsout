interface Params {
	text: string;
}

const rateLimitPattern =
	/usage limit|rate limit|limit reached|limit will reset|quota|hit your [^.\n]{0,40}limit|\b(?:weekly|daily|hourly|monthly)\s+limit\b|\b(?:status|error|code)\D{0,6}529\b|overloaded/i;

/**
 * Whether a harness's error output says the subscription wall is closed.
 *
 * Spelled once because both drivers turn on it identically, and two copies are
 * two chances for one to stop recognising a wall — which is exactly what
 * happened: the two hand-written lists drifted apart and neither matched the
 * period-qualified wording ("You've hit your weekly limit") the Claude Code
 * harness uses for a subscription cap, so a closed wall was misread as a
 * malformed report and cost a whole graded pass.
 *
 * Only ever consulted on an error path (a non-zero exit, an `is_error`
 * envelope, or a spawn that wrote no final message), so legitimate agent prose
 * about rate limits can never trip it. A false negative degrades to an ordinary
 * step failure rather than a park.
 *
 * @param text - the harness's error-path output, as the calling driver joins its streams
 */
export const isRateLimitMessage = ({ text }: Params): boolean => rateLimitPattern.test(text);
