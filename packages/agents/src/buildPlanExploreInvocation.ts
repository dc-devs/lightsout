import planExplorePrompt from '../prompts/planExplore.md';

interface Params {
	/** The overall feature request. */
	request: string;
	/** The specific area this explorer focuses on. */
	area: string;
}

/** Assemble one plan-explore invocation deterministically. */
export const buildPlanExploreInvocation = ({ request, area }: Params) => {
	const prompt = [
		`# Explore input`,
		[`- request: ${request}`, `- area to focus on: ${area}`].join('\n'),
		'Remember: your entire final message must be exactly one JSON ExploreReport object — nothing else.',
	].join('\n\n');

	return {
		systemPrompt: planExplorePrompt,
		prompt,
	};
};
