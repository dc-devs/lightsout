/**
 * The gate keys a block may configure that no checkpoint ever schedules, each
 * with the reason a `gate-overrides` list may not name it.
 *
 * Two files need this pair and would otherwise have to agree by hand:
 * `GateOverride` refuses a list that names one of them, and
 * `validateGateOverrideNames` keeps them out of the set of gates this repo has.
 * Stated once, so adding or removing a key is one edit rather than two files
 * that can drift apart.
 */
export const uncheckpointableGateKeys: Record<string, string> = {
	generate: "'generate' is not a checkpoint gate — gates.generate runs before an override's gates automatically, and not at all when the checkpoint is \"off\"",
	format: "'format' is not a checkpoint gate — gates.format runs once at the very end of the pipeline",
};
