/**
 * The role a tracker status plays in the lifecycle, as opposed to the name a
 * repository spells it with.
 *
 * Callers name a role and `LifecycleSettings.statusNames` turns it into the
 * configured name, so no step outside `resolveLifecycleSettings` ever spells a
 * status string.
 */
export const TrackerStatusRole = {
	/** Shaping is finished or was never needed, and implementation is waiting. */
	Ready: 'ready',
	/** Source-code changes have begun. */
	InProgress: 'in-progress',
	/** A merge was positively confirmed. */
	Done: 'done',
} as const;

export type TrackerStatusRole = (typeof TrackerStatusRole)[keyof typeof TrackerStatusRole];
