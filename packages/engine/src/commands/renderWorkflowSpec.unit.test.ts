import { describe, expect, test } from '@jest/globals';
import { renderWorkflowSpec } from '#src/commands/index.ts';

describe('renderWorkflowSpec', () => {
	test('carries the graphic’s own header, the brand gradient and the default artifact label', () => {
		const spec = renderWorkflowSpec({ id: 'implement' });

		expect(spec).toEqual(
			expect.objectContaining({
				title: 'How /implement turns the spec into verified code',
				subtitle: 'Ten steps, deterministic gates throughout, and a complete record saved to disk.',
				columns: 5,
				savedLabel: 'SAVED TO DISK',
				theme: { from: '#35d6e8', to: '#b06bf5' },
				banner: 'The model can claim success. Lightsout requires evidence.',
			}),
		);
	});

	test('renders one card per step, in the order the catalog lists them', () => {
		const spec = renderWorkflowSpec({ id: 'refactor' });

		expect(spec).toEqual(expect.objectContaining({ cards: expect.arrayContaining([expect.objectContaining({ title: 'START THE RUN' })]) }));
		expect(spec).toEqual(expect.objectContaining({ cards: expect.arrayContaining([expect.objectContaining({ title: 'REVIEW AND COMMIT' })]) }));
	});

	test('a step the engine does takes the far end of the gradient, and anything a person or an agent does takes the near one', () => {
		const spec = renderWorkflowSpec({ id: 'plan' });

		expect(spec).toEqual(
			expect.objectContaining({
				cards: expect.arrayContaining([
					expect.objectContaining({ title: 'INVESTIGATE WHAT THE CODE SAYS', tag: { label: 'the engine', tone: 'to' } }),
					expect.objectContaining({ title: 'SETTLE WHAT ONLY YOU CAN SETTLE', tag: { label: 'you decide', tone: 'from' } }),
				]),
			}),
		);
	});

	test('a step keeps its own artifact label, and one without it carries no label key at all', () => {
		const spec = renderWorkflowSpec({ id: 'refactor' });

		expect(spec).toEqual(
			expect.objectContaining({
				cards: expect.arrayContaining([
					// the one step whose artifacts are read rather than written overrides the graphic-wide label
					expect.objectContaining({ title: 'FIND THE WORK', savedLabel: 'READ FROM DISK' }),
					// an exact object rather than a containing one: a step naming no label of
					// its own leaves the key out entirely rather than repeating the default
					{
						title: 'GROUP INTO BATCHES',
						tag: expect.anything(),
						bullets: expect.anything(),
						note: expect.anything(),
						saved: expect.anything(),
					},
				]),
			}),
		);
	});

	test('renders every step as a card, in the catalog’s order and no more than that', () => {
		const spec = renderWorkflowSpec({ id: 'plan' });

		expect(spec).toEqual(
			expect.objectContaining({
				cards: [
					expect.objectContaining({ title: 'CAPTURE THE REQUEST AS IT WAS WRITTEN' }),
					expect.objectContaining({ title: 'INVESTIGATE WHAT THE CODE SAYS' }),
					expect.objectContaining({ title: 'SETTLE WHAT ONLY YOU CAN SETTLE' }),
					expect.objectContaining({ title: 'CHALLENGE THE DESIGN BEFORE A LINE IS WRITTEN' }),
					expect.objectContaining({ title: 'WRITE THE IMPLEMENTATION PLAN' }),
					expect.objectContaining({ title: 'CHALLENGE THE WRITTEN PLAN' }),
					expect.objectContaining({ title: 'REPAIR EVERY FINDING, THEN REVIEW THE WHOLE' }),
					expect.objectContaining({ title: 'RECORD READINESS, HAND OFF' }),
				],
			}),
		);
	});

	test('a card carries the step’s bullets, its note and the files it writes, and nothing else', () => {
		const spec = renderWorkflowSpec({ id: 'plan' });

		expect(spec).toEqual(
			expect.objectContaining({
				cards: expect.arrayContaining([
					{
						title: 'INVESTIGATE WHAT THE CODE SAYS',
						tag: { label: 'the engine', tone: 'to' },
						bullets: [
							'Open the files the request touches and record what was read',
							'Record what could not be established as an unknown, not as a guess',
							'Share each conclusion, so the next role reads it instead of re-deriving it',
						],
						note: 'Stops the plan resting on a signature nobody opened',
						saved: ['.lightsout/plans/<name>/.planning/'],
					},
				]),
			}),
		);
	});

	test('a command with no graphic throws rather than writing an empty spec', () => {
		expect(() => renderWorkflowSpec({ id: 'doctor' })).toThrow('no workflow graphic');
	});

	test('a word no command answers to throws for the same reason', () => {
		expect(() => renderWorkflowSpec({ id: 'nonesuch' })).toThrow('no workflow graphic');
	});
});
