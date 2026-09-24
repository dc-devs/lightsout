// `readRunCommitAddress`, `describeUnownedEdits` and `buildRunCommitMessage`
// stay off this barrel: they are how the module decides and assembles, and a
// caller that could reach them could commit under an address no run derived,
// commit past the guard, or write a message no composer settled on.
// `composeCommitMessage` is on it because the queue's two commit points compose
// through it.

export { commitRunWork } from '#src/commit/commitRunWork.ts';
export { commitWorkOrderWork } from '#src/commit/commitWorkOrderWork.ts';
export { composeCommitMessage } from '#src/commit/composeCommitMessage.ts';
