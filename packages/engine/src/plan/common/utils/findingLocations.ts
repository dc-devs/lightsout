import type { GapObservation } from '#src/contracts/index.ts';

interface Params {
	/** Every observation the finding holds; empty on a single-observation finding or a record written before grouping existed. */
	observations: GapObservation[];
	/** The finding's own plan file — the one location when it holds no observations. */
	phase: string;
}

/**
 * The distinct plan files one finding touches, in first-appearance order — the
 * set every per-location rule iterates: which plan texts a judge batch carries,
 * which citations a dismissal must supply, and which locations a closure must
 * confirm one by one.
 *
 * Never sorted: a finding's own `phase` is its representative location, and
 * sorting would move it away from the front.
 */
export const findingLocations = ({ observations, phase }: Params): string[] =>
	observations.length === 0 ? [phase] : [...new Set(observations.map((observation) => observation.phase))];
