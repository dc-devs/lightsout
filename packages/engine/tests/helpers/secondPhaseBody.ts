import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';

/** The clean plan again, creating a different file — so each phase's gap-check prompt is identifiable. */
export const secondPhaseBody = (): string =>
	cleanPlanBody({ title: 'Graded Plan' })
		.replace(/new-thing/g, 'other-thing')
		.replace(/newThing/g, 'otherThing');
