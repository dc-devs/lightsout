import { z } from 'zod';
import { SourceEvidenceKind } from '#src/contracts/plan/evidence/SourceEvidenceKind.ts';

/**
 * One file's collected evidence, keyed by repo-relative path and bound to the
 * bytes it was taken from.
 *
 * The hash is the entry's identity: an entry whose source no longer hashes to
 * it is re-collected rather than trusted. Line numbers are deliberately absent —
 * they are hints, not identity, and a writer that needs a location opens the
 * file. Every optional field defaults, so a record an earlier run wrote still
 * parses at the boundary.
 */
export const SourceEvidenceEntry = z.object({
	/** Repo-relative path this entry is the evidence for. */
	path: z.string().min(1),
	/** sha256 of the file contents this entry was taken from; empty when the file was absent. */
	sha256: z.string().default(''),
	kind: z.enum(SourceEvidenceKind),
	/** Size in bytes of the contents it was taken from; 0 when the file was absent. */
	bytes: z.number().int().nonnegative().default(0),
	/** The evidence text itself — the whole file, or the kept definitions. */
	text: z.string().default(''),
	/** Why the facts named this file, in the facts' own words: a role, a takeaway, an integration point's name and signature. */
	roles: z.array(z.string()).default([]),
	/** Declared names the kept text holds; empty unless `kind` is `Definitions`. */
	definitions: z.array(z.string()).default([]),
});

export type SourceEvidenceEntry = z.infer<typeof SourceEvidenceEntry>;
