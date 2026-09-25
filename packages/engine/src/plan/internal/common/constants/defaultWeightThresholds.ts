/** The counts above which a plan file is heavy when `plan.weight-thresholds` leaves them unset: more than three created source files, or more than one package. */
export const defaultWeightThresholds = { createdFiles: 3, packages: 1 } as const;
