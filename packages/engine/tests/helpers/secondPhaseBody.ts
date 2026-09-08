import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';

/** The clean plan again, creating a different file — so each phase's gap-check prompt is identifiable. It is only ever a phase of a phased deliverable, so it carries the Decision Log pointer. */
export const secondPhaseBody = (): string =>
	cleanPlanBody({ title: 'Graded Plan', reference: true })
		.replace(/new-thing/g, 'other-thing')
		.replace(/newThing/g, 'otherThing');
