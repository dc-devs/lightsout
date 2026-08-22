/**
 * One resolved plan deliverable file: its path on disk and its text. This is
 * what `resolvePlanDeliverable` hands the grade and dedup passes, what
 * `selectPhaseFiles` narrows, and what each of their agent spawns is given.
 *
 * Distinct from `PhaseFile`, which is a *parsed* plan file carrying the identity
 * every finding is labelled by — this is the raw text, before anything reads it.
 */
export interface DeliverableFile {
	/** Absolute path on disk. */
	path: string;
	text: string;
}
