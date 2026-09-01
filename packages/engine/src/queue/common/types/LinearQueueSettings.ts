import type { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';

export interface LinearQueueSettings {
	tracker: 'linear';
	ticketPrefix: string;
	team: string;
	routeLabels: Record<QueueRoute, string>;
	maxParallel: number;
	apiKey: string;
	eligibleStatuses: string[];
	inProgressStatus: string;
	setup?: string;
	branchTemplate: string;
	decisionsHeading: string;
	workerTimeoutMs: number;
	questionTimeoutMs: number;
	parkedLabel?: string;
}
