import type { RunStepView } from '@lightsout/engine';

/**
 * One step as the run detail page receives it over the wire.
 *
 * The engine's `RunStepView` in every respect but the report's declared type,
 * which narrows from `unknown` to "an object of some shape". A server
 * function's result has to be provably serializable, and `unknown` is the one
 * thing that cannot be proved — it admits functions and class instances, so the
 * framework refuses to carry it. The value is untouched: still whatever the
 * manifest stored, still read by shape rather than by declaration.
 */
export interface RunDetailStep extends Omit<RunStepView, 'report'> {
	/** The step's validated agent report, as opaque here as the manifest stores it. */
	report?: object;
}
