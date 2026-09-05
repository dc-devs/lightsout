/**
 * The one answer to which files in a plan folder travel. Everything else the
 * folder holds — agent transcripts, manifests, progress logs — is run state,
 * and run state never leaves the machine that made it.
 *
 * One object rather than two exports: publish writes an attachment per name
 * here, and the fetch matches an attachment's title against exactly the same
 * names. Two lists could be updated apart, which would leave a file publish
 * uploads and the fetch never looks for.
 *
 * `deliverable` is the naming rule, copied from `resolvePlanDeliverable`, and
 * it is NOT a safety guard: it admits a path separator exactly as the resolver's
 * own pattern does, which is harmless against a directory listing and is not
 * harmless against an attachment title a stranger can set. A caller reading
 * titles off a ticket rejects a non-bare file name before consulting this
 * field, and must not narrow the field to do it — a narrower pattern here would
 * stop mirroring the resolver, and a phase file publish uploads would be one the
 * fetch silently refuses to restore.
 *
 * The annotation is written out rather than left to `as const` so `records` is a
 * `string[]` a caller can `includes` a plain string against without a cast.
 */
export const durablePlanFileNames: { records: string[]; deliverable: RegExp } = {
	/** The plan's working records, each attached when the folder holds it. */
	records: ['brainstorm-notes.md', 'decisions.json', 'grade.json'],
	/** A plan deliverable's own file name, spelled exactly as `resolvePlanDeliverable` matches it. */
	deliverable: /^(?:plan\.md|overview\.md|phase\d+.*\.md)$/,
};
