/**
 * How much a gate costs to run, which is what decides when it may start.
 *
 * The split is the engine's own rather than a label a config writes: no project
 * today has a unit suite slower than its end-to-end suite, so a key saying so
 * would be config churn for a rule the gate's kind already states.
 */
export const GateTier = {
	/** Type-check, lint and the unit suite — fast enough to run at every checkpoint whatever else is red. */
	Cheap: 'cheap',
	/** Every custom `test-*` suite, and the build — paid for only once the cheap gates are green everywhere. */
	Expensive: 'expensive',
} as const;

export type GateTier = (typeof GateTier)[keyof typeof GateTier];
