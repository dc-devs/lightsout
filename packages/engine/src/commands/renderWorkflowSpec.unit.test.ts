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
					expect.objectContaining({ title: 'RECORD THE FACTS', tag: { label: 'the engine', tone: 'to' } }),
					expect.objectContaining({ title: 'CHOOSE THE APPROACH', tag: { label: 'you decide', tone: 'from' } }),
				]),
			}),
		);
	});

	test('a step keeps its own artifact label, and one without a note carries no note key at all', () => {
		const spec = renderWorkflowSpec({ id: 'plan' });

		expect(spec).toEqual(
			expect.objectContaining({
				cards: expect.arrayContaining([
					expect.objectContaining({
						title: 'CREATE THE PLAN WORKSPACE',
						savedLabel: 'SAVED WHEN NOTES EXIST',
						saved: ['.lightsout/plans/<name>/brainstorm-notes.md'],
					}),
				]),
			}),
		);
	});

	test('renders every step as a card, in the catalog’s order and no more than that', () => {
		const spec = renderWorkflowSpec({ id: 'plan' });

		expect(spec).toEqual(
			expect.objectContaining({
				cards: [
					expect.objectContaining({ title: 'CREATE THE PLAN WORKSPACE' }),
					expect.objectContaining({ title: 'RECORD THE FACTS' }),
					expect.objectContaining({ title: 'SETTLE THE SCOPE AND CONSTRAINTS' }),
					expect.objectContaining({ title: 'CHOOSE THE APPROACH' }),
					expect.objectContaining({ title: 'WRITE THE IMPLEMENTATION PLAN' }),
					expect.objectContaining({ title: 'STRESS-TEST THE PLAN' }),
					expect.objectContaining({ title: 'CATCH DUPLICATION BEFORE CODING' }),
					expect.objectContaining({ title: 'GET THE PLAN TO AN A GRADE' }),
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
						title: 'RECORD THE FACTS',
						tag: { label: 'the engine', tone: 'to' },
						bullets: [
							'Inspect the code and files relevant to the plan request',
							'Record the repository facts the plan will rely on',
							'Verify every referenced file and path before moving forward',
						],
						note: 'Ensures the plan reflects the repository’s current state, not assumptions',
						saved: ['.lightsout/plans/<name>/facts.json'],
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
