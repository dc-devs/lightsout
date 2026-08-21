// The batch's own steps — the invoker it builds, the tests-only check, the gate
// settler, the measurement — are internal: they exist to be composed by
// runCoverageBatch and are covered through it. Published here are the two the
// rest of the run reaches for, each of which carries its own tests.

export { invokeCoverageAgent } from '#src/coverage/batch/invokeCoverageAgent.ts';
export { runCoverageBatch } from '#src/coverage/batch/runCoverageBatch.ts';
