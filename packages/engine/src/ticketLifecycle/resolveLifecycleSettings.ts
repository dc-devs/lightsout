import { defaultPlanningStatusLabels, PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';
import type { LifecycleSettings } from '#src/ticketLifecycle/common/types/LifecycleSettings.ts';
import type { TrackerFailure } from '#src/ticketTracker/index.ts';

interface Params {
	config: LightsoutConfig;
}

/** The label a planning status resolves to, or the sentence naming the label two of them share. */
// Annotated because inference would widen each branch with the other's absent
// key, so neither would satisfy the resolved settings the caller returns.
const readPlanningStatusLabels = ({
	queue,
}: {
	queue: LightsoutConfig['queue'];
}): { planningStatusLabels: Record<PlanningStatus, string> } | TrackerFailure => {
	const configured = queue?.['planning-status-labels'];
	const named = ({ status }: { status: PlanningStatus }) => configured?.[status] ?? defaultPlanningStatusLabels[status];
	const planningStatusLabels: Record<PlanningStatus, string> = {
		[PlanningStatus.NeedsBrainstorm]: named({ status: PlanningStatus.NeedsBrainstorm }),
		[PlanningStatus.NeedsPlan]: named({ status: PlanningStatus.NeedsPlan }),
		[PlanningStatus.ReadyAutoPlan]: named({ status: PlanningStatus.ReadyAutoPlan }),
		[PlanningStatus.Complete]: named({ status: PlanningStatus.Complete }),
		[PlanningStatus.NotNeeded]: named({ status: PlanningStatus.NotNeeded }),
	};

	for (const label of new Set(Object.values(planningStatusLabels))) {
		const sharing = Object.values(PlanningStatus).filter((status) => planningStatusLabels[status] === label);

		if (sharing.length > 1) {
			return {
				error: `\`queue.planning-status-labels\` maps '${label}' to both ${sharing.join(' and ')} — one label cannot mean two planning statuses`,
			};
		}
	}

	return { planningStatusLabels };
};

/**
 * The lifecycle settings with their defaults applied, or the one sentence
 * saying why the configured ones cannot work.
 *
 * Every value has a default, so a repository with no `queue` block still
 * resolves — writing a ticket's planning status needs no queue at all.
 *
 * A resolved map sending one label to two planning statuses is refused here: a
 * strict five-key object does not stop the same string twice, and the result
 * would be a ticket the classifier reports ambiguous and the queue skips
 * forever.
 */
export const resolveLifecycleSettings = ({ config }: Params): LifecycleSettings | TrackerFailure => {
	const queue = config.queue;
	const labels = readPlanningStatusLabels({ queue });

	if ('error' in labels) {
		return labels;
	}

	return {
		planningStatusLabels: labels.planningStatusLabels,
		statusNames: {
			[TrackerStatusRole.Ready]: queue?.['ready-status'] ?? 'Ready to implement',
			[TrackerStatusRole.InProgress]: queue?.['in-progress-status'] ?? 'In Progress',
			[TrackerStatusRole.Done]: queue?.['done-status'] ?? 'Done',
		},
		eligibleStatuses: queue?.['eligible-statuses'] ?? ['Backlog', 'Ready to implement'],
	};
};
