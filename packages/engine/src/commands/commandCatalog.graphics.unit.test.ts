import { describe, expect, test } from '@jest/globals';
import { commandCatalog } from '#src/commands/index.ts';

const setupCatalog = () => ({ byId: new Map(commandCatalog.map((entry) => [entry.id, entry])) });

// The infographic half of the catalog: which commands draw one, and what each
// drawn step is allowed to say. Split from the catalog's own cases so neither
// file has to be read whole to answer a question about the other.
describe('commandCatalog graphics', () => {
	test('every step names one of the three actors, a title in caps, and two to four bullets', () => {
		const malformed = commandCatalog.flatMap((entry) =>
			entry.steps
				.filter(
					(step) =>
						!['the engine', 'the agent', 'you decide'].includes(step.actor) ||
						step.title !== step.title.toUpperCase() ||
						step.bullets.length < 2 ||
						step.bullets.length > 4,
				)
				.map((step) => `${entry.id}: ${step.title}`),
		);

		expect(malformed).toStrictEqual([]);
	});

	test('overrides the graphic-wide artifact label only where a step reads a file or writes one conditionally', () => {
		const overrides = commandCatalog.flatMap((entry) =>
			entry.steps.filter((step) => step.savedLabel !== undefined).map((step) => [step.title, step.savedLabel]),
		);

		expect(overrides).toStrictEqual([
			['CREATE THE PLAN WORKSPACE', 'SAVED WHEN NOTES EXIST'],
			['FIND THE WORK', 'READ FROM DISK'],
		]);
	});

	test('each drawn command’s steps run from the step that opens its infographic to the step that closes it', () => {
		const { byId } = setupCatalog();
		const ends = ['plan', 'implement', 'refactor'].map((id) => {
			const steps = byId.get(id)?.steps ?? [];

			return [id, steps.at(0)?.title, steps.at(-1)?.title];
		});

		expect(ends).toStrictEqual([
			['plan', 'CREATE THE PLAN WORKSPACE', 'GET THE PLAN TO AN A GRADE'],
			['implement', 'START THE RUN', 'REPORT THE RESULT'],
			['refactor', 'START THE RUN', 'REVIEW AND COMMIT'],
		]);
	});
});
