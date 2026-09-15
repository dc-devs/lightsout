import type { Effort, LightsoutConfig, Permissions, PlanningVocabulary } from '#src/contracts/index.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import type { PlanningMode } from '#src/plan/workflow/common/constants/PlanningMode.ts';
import type { PlanningServices } from '#src/plan/workflow/common/types/PlanningServices.ts';
import type { PlanningStoreIO } from '#src/plan/workflow/common/types/PlanningStoreIO.ts';
import type { PlanningLease } from '#src/plan/workflow/store/index.ts';

/** Explicit runtime dependencies keep deterministic work and provider selection under engine ownership. */
export interface PlanningRuntime {
	cwd: string;
	name: string;
	driver: Driver;
	config: LightsoutConfig;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	standards: string;
	mode: PlanningMode;
	stage: (typeof PlanningVocabulary.Stage)[keyof typeof PlanningVocabulary.Stage];
	services: PlanningServices;
	lease: Pick<PlanningLease, 'create' | 'renew' | 'fenceExpired'>;
	clock?: () => number;
	storeIO?: PlanningStoreIO;
	/** Actual in-process output retained while durable storage is unavailable; never a substitute for committed authority. */
	pendingOutput?: { workId: string; attemptId: string; result: DriverResult; startedAt: number; endedAt: number };
	onProgress?: (message: string) => void;
}
