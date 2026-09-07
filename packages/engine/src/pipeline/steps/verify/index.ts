// `approveRunnerSnapshots` is deliberately not published: it is the post-gate
// half of the sequence below, and a caller that ran it on its own would record
// a snapshot as approved without the checkpoint that earns it.

export { reviewAndVerify } from '#src/pipeline/steps/verify/reviewAndVerify.ts';
