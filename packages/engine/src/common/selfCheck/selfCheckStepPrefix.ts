/**
 * What every step name a self-check's gate executions are recorded under begins
 * with.
 *
 * Declared once because two files depend on the exact spelling from opposite
 * ends: `buildSelfCheckStep` writes it and `isSelfCheckStep` reads it back, and
 * a prefix changed in one of them alone would leave the reader silently matching
 * a name nothing is written under.
 */
export const selfCheckStepPrefix = 'self-check-';
