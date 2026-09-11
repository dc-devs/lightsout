/**
 * The two caps every candidate judge batch honours together, so one judge prompt
 * never becomes a whole-plan read: at most this many observations, spanning at
 * most this many plan files. The plan-file cap exists because a judge is given
 * the full text of every plan file its batch spans.
 *
 * Both bind only the decision to combine two or more findings. A single finding
 * is never split, so one whose own locations already exceed `maxPlanFiles` is a
 * batch of one over the cap rather than a finding nobody can judge.
 */
export const gapBatchLimits = { maxObservations: 8, maxPlanFiles: 3 } as const;
