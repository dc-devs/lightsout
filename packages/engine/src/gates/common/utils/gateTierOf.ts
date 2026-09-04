import { GateTier } from '#src/gates/common/constants/GateTier.ts';

/** The families the engine calls cheap — everything else, custom `test-*` suites and the build, is expensive. */
const cheapFamilies = new Set(['check', 'test', 'testCoverage']);

interface Params {
	/** The gate's family, as `GateEntry.family` carries it. */
	family: string;
}

/** Which tier a gate belongs to — the engine's split, stated once so the runner and its narration cannot disagree. */
export const gateTierOf = ({ family }: Params): GateTier => (cheapFamilies.has(family) ? GateTier.Cheap : GateTier.Expensive);
