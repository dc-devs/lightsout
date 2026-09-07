// The repair stages, the context they share and the verification verdict they
// pass along are this module's private companions: they serve only the
// checkpoint below, and are covered through it. Published here is the step the
// pipeline schedules.

export { verifyStep } from '#src/pipeline/steps/verifyStep/verifyStep.ts';
