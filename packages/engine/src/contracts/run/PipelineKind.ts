/** Which pipeline owns a run — the manifest's discriminator, and what every reader narrows on. */
export const PipelineKind = {
	/** A plan implemented step by step. What a manifest predating the discriminator is read as. */
	Implement: 'implement',
	/** A standards-check work-list burned down batch by batch. */
	Refactor: 'refactor',
	/** A coordinator that runs one child run per phase of an overview. */
	Phases: 'phases',
	/** A coverage measurement raised to its threshold batch by batch. */
	Coverage: 'coverage',
} as const;

export type PipelineKind = (typeof PipelineKind)[keyof typeof PipelineKind];
