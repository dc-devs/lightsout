import type { RunView } from '@lightsout/engine';
import type { RunDetailStep } from '#src/features/runDetail/common/types/RunDetailStep.ts';

/**
 * A run's whole evidence as the page receives it.
 *
 * The engine's `RunView` with one difference, and it is a difference of type
 * rather than of value: each step's opaque report is declared as an object so
 * the run can cross a server function's boundary (see {@link RunDetailStep}).
 * Every other field is the engine's own, and every number on the page still
 * comes from there.
 */
export interface RunDetailView extends Omit<RunView, 'steps'> {
	steps: RunDetailStep[];
}
