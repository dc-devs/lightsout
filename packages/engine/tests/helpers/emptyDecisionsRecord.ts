import type { DecisionsRecord } from '#src/contracts/index.ts';

interface Params {
	/** Kebab plan name the record names as its own; defaults to the plan the shared fixture bodies are named after. */
	planName?: string;
}

/**
 * The record with no rows. Every clean body renders its `## Decision Log` from
 * an empty record, so this is what the lint has to hold those bodies to for the
 * currency check to pass, and what the fixture builders write to disk beside
 * them.
 */
export const emptyDecisionsRecord = ({ planName = 'demo' }: Params = {}): DecisionsRecord => ({ planName, decisions: [] });
