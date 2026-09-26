/** Which of the two histories a chart draws: the one that happened, or the one with every split undone. */
export const SprawlLane = {
	With: 'with',
	Without: 'without',
} as const;

export type SprawlLane = (typeof SprawlLane)[keyof typeof SprawlLane];
