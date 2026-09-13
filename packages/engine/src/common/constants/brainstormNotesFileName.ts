/**
 * The brainstorm's write-up.
 *
 * For a plan inside a ticket folder the brainstorm generation owns this title
 * outright: the plan generation never carries it, and `plan publish` publishes
 * the brainstorm generation first whenever the notes on disk are not the bytes
 * its marker commits.
 *
 * A legacy folder's two generations still both carry it — the brainstorm as its
 * own record, the plan as the shaping that preceded it — which is why
 * `isPlanOnlyAttachmentName` and `isBrainstormOnlyAttachmentName` remain: with
 * no plan id prefix, neither generation may take the shared title as evidence
 * that it was the one published.
 */
export const brainstormNotesFileName = 'brainstorm-notes.md';
