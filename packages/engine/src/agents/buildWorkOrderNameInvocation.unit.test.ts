import { expect, test } from '@jest/globals';
import { buildWorkOrderNameInvocation } from '#src/agents/index.ts';

interface SetupParams {
	ticketRef?: string;
	/** The tracker's own sentence-length title — sentinel-marked so leakage into the role prompt shows. */
	title?: string;
}

const setupNaming = ({ ticketRef = 'LO-158', title = "A ticket's branch name has no single author — TITLE-SENTINEL" }: SetupParams = {}) => ({
	ticketRef,
	title,
});

test('buildWorkOrderNameInvocation: carries the ticket reference and its title in the prompt, with the role prompt as the system prompt', () => {
	const { ticketRef, title } = setupNaming();

	const { systemPrompt, prompt } = buildWorkOrderNameInvocation({ ticketRef, title });

	// the agent is handed the reference and the title it must summarise
	expect(prompt.includes('LO-158')).toBeTruthy();
	expect(prompt.includes("A ticket's branch name has no single author — TITLE-SENTINEL")).toBeTruthy();
	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role')).toBeTruthy();
	// nothing about this work order reaches the cached role prompt
	expect(systemPrompt.includes('LO-158')).toBeFalsy();
	expect(systemPrompt.includes('TITLE-SENTINEL')).toBeFalsy();
	// only the user prompt varies between invocations, so the role prompt is one fixed text
	expect(buildWorkOrderNameInvocation(setupNaming({ ticketRef: 'LO-999', title: 'something else entirely' })).systemPrompt).toBe(systemPrompt);
});

test('buildWorkOrderNameInvocation: the user prompt is the ticket section, the title section and the report reminder in that order', () => {
	const { ticketRef, title } = setupNaming({ ticketRef: 'LO-158', title: "A ticket's branch name has no single author" });

	const { prompt } = buildWorkOrderNameInvocation({ ticketRef, title });

	expect(prompt).toBe(
		'# Ticket\n\nLO-158\n\n' +
			"# Title\n\nA ticket's branch name has no single author\n\n" +
			'Remember: your entire final message must be exactly one JSON object carrying the words — nothing else.',
	);
});
