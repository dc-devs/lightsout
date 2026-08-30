import type { RunStatus } from '#src/contracts/index.ts';
import type { RunProgressRow } from '#src/views/common/types/RunProgressRow.ts';

/** A run's progress block as data, ready to render — see {@link getRunProgress}. */
export interface RunProgress {
	runId: string;
	/** First eight characters — the form every lightsout report prints and `--run` accepts. */
	shortId: string;
	/** Human label derived from the plan path, from `getRunTitle`. */
	title: string;
	/** The run's own status, which is what a watch stops on. */
	status: RunStatus;
	/** A live process stands behind this run right now. */
	live: boolean;
	rows: RunProgressRow[];
	/** Wall time from run start to the manifest's last write, plus the time since that write when the run is live. */
	elapsedMs: number;
	/** Source files the run has changed so far. */
	changedFileCount: number;
	/** Run-wide API-equivalent cost; undefined for a driver that reports no usage. */
	costUsd: number | undefined;
	/** The last line the run narrated, or undefined when it has narrated nothing readable. */
	now: string | undefined;
	/** This run will ship and no ship result is on disk yet — what tells a watch its story is not over even though the run's own status is terminal. */
	awaitingShip: boolean;
}
