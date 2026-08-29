import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';

interface Params {
	/** The raw config value, e.g. '4h'. */
	value: string;
	/** The config key the value came from, named verbatim in the failure message. */
	key: string;
}

/**
 * A duration string in milliseconds, or the one sentence saying why it is not
 * one.
 *
 * The accepted forms are deliberately narrow — a positive integer followed by
 * `s`, `m` or `h` — so no two readers ever disagree about what a value means.
 * Anything else answers a failure naming the key and the accepted forms rather
 * than guessing a unit.
 */
export const parseDurationMs = ({ value, key }: Params): number | QueueFailure => {
	const matched = /^(\d+)([smh])$/.exec(value.trim());
	const amount = Number(matched?.[1] ?? 0);

	if (matched === null || amount === 0) {
		return { error: `\`${key}\` must be a duration like '90s', '45m' or '4h' — got '${value}'` };
	}

	const perUnitMs = matched[2] === 's' ? 1000 : matched[2] === 'm' ? 60_000 : 3_600_000;

	return amount * perUnitMs;
};
