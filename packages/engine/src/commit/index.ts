// `readRunCommitSubject` and `describeUnownedEdits` stay off this barrel: they
// are how `commitRunWork` decides, and a caller that could reach them could
// commit under a subject no run derived, or commit past the guard.

export { buildRunCommitMessage } from '#src/commit/buildRunCommitMessage.ts';
export { commitRunWork } from '#src/commit/commitRunWork.ts';
export { commitTicketWork } from '#src/commit/commitTicketWork.ts';
