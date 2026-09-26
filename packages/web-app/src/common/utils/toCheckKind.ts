import { CheckKind } from '#src/common/constants/CheckKind.ts';

interface Params {
	/** The engine's own flag: true when a rule ships code that decides it. */
	checked: boolean;
}

/**
 * The kind of check a rule is, from the flag the engine's rule listing carries.
 *
 * @param checked - whether the rule ships a check in code
 */
export const toCheckKind = ({ checked }: Params): CheckKind => (checked ? CheckKind.Deterministic : CheckKind.Agent);
