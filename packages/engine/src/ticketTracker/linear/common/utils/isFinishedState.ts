interface Params {
	/** The workflow state's own type, or undefined when the state could not be read. */
	stateType: string | undefined;
}

/**
 * Workflow-state types that mean a ticket is done with.
 *
 * A canceled ticket counts as finished deliberately: a ticket someone gave up
 * on must not block its dependent forever.
 */
const finishedStateTypes = new Set(['completed', 'canceled']);

/**
 * Whether Linear itself files this workflow state as a finished one.
 *
 * An unreadable state answers false, so a blocker whose state could not be read
 * stays a blocker: waiting one extra run is recoverable, shipping a dependent
 * ahead of its blocker is not.
 */
export const isFinishedState = ({ stateType }: Params): boolean => stateType !== undefined && finishedStateTypes.has(stateType);
