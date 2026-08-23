import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';

/**
 * The clean skeleton with a placeholder planted in its context prose, so
 * `lintPlanStructure` reports a blocking finding and the draft loop is forced
 * through at least one repair round.
 */
export const dirtyPlanBody = ({ markers = 'TBD' }: { markers?: string } = {}) =>
	cleanPlanBody().replace('A new module exporting', `${markers} — a new module exporting`);
