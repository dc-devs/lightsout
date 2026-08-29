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
	/** A coordinator draining a tracker's backlog into parallel worktrees. */
	Queue: 'queue',
	/** One ticket built straight from its body, with the repo's gates as the only bar. */
	Direct: 'direct',
} as const;

export type PipelineKind = (typeof PipelineKind)[keyof typeof PipelineKind];
