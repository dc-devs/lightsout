// The four phase groups this sequence is assembled from — the ledger lint, the
// implement trio, the unit-test trio and the refactor steps — are private
// companions: each serves only the sequence below, and each is covered through
// it. Published here is the step list the pipeline runs.

export { buildSteps } from '#src/pipeline/steps/buildSteps/buildSteps.ts';
