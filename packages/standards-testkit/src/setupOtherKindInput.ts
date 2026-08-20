import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { setupCloneSpansInput } from '#src/setupCloneSpansInput.ts';

/**
 * An input of a kind the rule under test did not declare.
 *
 * Every check begins by narrowing the input union to its own arm and returning
 * nothing for anything else. That guard is unreachable in a real run — the
 * engine only ever hands a check the kind it asked for — so each rule's tests
 * prove it by hand, and thirty-six of them wrote out the same clone-spans
 * literal to do it.
 *
 * Any arm would serve. Clone-spans is the one used because it is the smallest,
 * and because a rule whose own kind IS clone-spans can reach for a different
 * factory without the two ever colliding.
 */
export const setupOtherKindInput = (): StandardsCheckInput => setupCloneSpansInput({ source: ['src/subject.ts'] });
