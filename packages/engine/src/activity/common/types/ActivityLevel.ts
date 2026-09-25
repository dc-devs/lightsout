import type { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import type { RunStatus } from '#src/contracts/run/RunStatus.ts';

/**
 * A handle on one open level of an activity record — the value a writer holds
 * and threads through the parameter objects its own functions already take.
 * There is no ambient store behind it, because an ambient level would be lost
 * across the fan-outs the engine runs agents in.
 *
 * `open`, `close` and `recordProcess` return synchronously and write through a
 * shared queue, because a caller in a hot path must not await evidence — and
 * chaining is what keeps the lines in call order anyway. `settled` exists for
 * the callers that reach process exit immediately after closing a level.
 */
export interface ActivityLevel {
	/** This level's id — the `parentId` of anything opened beneath it. */
	readonly id: string;
	/** Open a child level and answer its handle. */
	open: (params: { level: ActivityLevelKind; label: string }) => ActivityLevel;
	/** Close this level. A second call writes nothing. */
	close: (params: { outcome: RunStatus }) => void;
	/**
	 * Record one harness process that ran inside this level. Its parameter is
	 * the mark itself less the two fields the handle already knows, so the
	 * contract stays the single statement of what a recorded process carries.
	 */
	recordProcess: (params: Omit<HarnessProcessMark, 'kind' | 'levelId'>) => void;
	/** Resolves once every mark written through this recorder has reached disk. */
	settled: () => Promise<void>;
}
