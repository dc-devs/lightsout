import { z } from 'zod';
import { SourceEvidenceEntry } from '#src/contracts/plan/evidence/SourceEvidenceEntry.ts';

/**
 * The persisted `source-evidence.json` for one plan workspace: the source a plan
 * writer needs, collected once from the verified facts' own recorded locations
 * rather than re-read by every spawn.
 *
 * An array of entries carrying their own `path`, rather than an object keyed by
 * path, so the record is ordinary JSON that diffs and parses the way every other
 * engine record does.
 */
export const SourceEvidenceIndex = z.object({
	/** Kebab plan name — which plan folder this record belongs to. */
	planName: z.string(),
	/** One entry per repo-relative path, sorted by path. */
	entries: z.array(SourceEvidenceEntry).default([]),
	collectedAt: z.string(),
});

export type SourceEvidenceIndex = z.infer<typeof SourceEvidenceIndex>;
