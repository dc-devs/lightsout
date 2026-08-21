import type { RawStandardsFinding } from '#src/RawStandardsFinding.ts';
import type { StandardsCheckInput } from '#src/StandardsCheckInput.ts';

/**
 * The call signature every package check satisfies. It receives data the engine
 * already built and returns the sites it objects to — no filesystem, no
 * severity, no rule id.
 */
export type StandardsCheckFunction = (params: {
	input: StandardsCheckInput;
	/** The rule's resolved numeric settings — front-matter defaults under any config override. */
	settings: Record<string, number>;
}) => RawStandardsFinding[] | Promise<RawStandardsFinding[]>;
