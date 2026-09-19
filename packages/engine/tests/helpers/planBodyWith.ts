import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';

interface Params {
	/** The prose to stand in for the clean plan's one-sentence Context. */
	snippet: string;
}

/** The clean plan with a snippet standing in for its Context prose, so the only finding a lint can raise is the one the snippet arranged. */
export const planBodyWith = ({ snippet }: Params): string => cleanPlanBody().replace('A tiny clean plan for the structural lint.', snippet);
