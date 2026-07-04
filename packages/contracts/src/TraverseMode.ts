/** Output modes are renderers over one trace artifact, never separate traversals (prototype decision T10). */
export const TraverseMode = {
	Answer: 'answer',
	Doc: 'doc',
	Diagram: 'diagram',
	Plan: 'plan',
	Bug: 'bug',
} as const;

export type TraverseMode = (typeof TraverseMode)[keyof typeof TraverseMode];
