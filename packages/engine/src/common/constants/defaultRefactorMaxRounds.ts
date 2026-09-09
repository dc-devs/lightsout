/**
 * How many cleanup executor rounds an implementation run may spend when
 * `implement.refactor.max-rounds` is not configured.
 *
 * Two, because that is the ceiling the cleanup step already enforced before the
 * key existed — the key makes an existing number configurable rather than
 * changing what an unconfigured repository gets.
 *
 * One number rather than a copy per caller because the loop that spends the
 * rounds, the run report that says how many were spent and the config view that
 * announces the budget must agree: a report naming a budget the loop does not
 * enforce is a lie nobody would catch.
 */
export const defaultRefactorMaxRounds = 2;
