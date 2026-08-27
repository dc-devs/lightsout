import { StatusBadge } from '#src/appUI/index.ts';
import { statusBadgeConfig } from '#src/common/constants/statusBadgeConfig.ts';
import type { RunDetailStep } from '#src/features/runDetail/common/types/RunDetailStep.ts';
import { ChildRunLink } from '#src/features/runDetail/screens/RunDetail/components/ChildRunLink.tsx';

interface Props {
	steps: RunDetailStep[];
	/** Render each child run as plain mono text — the demo frame, whose runs are in no public listing. Defaults false. */
	linksDisabled?: boolean;
}

/**
 * A coordinator's phases: which file each ran, how it ended, and the way into
 * the run that did it.
 *
 * The phase file's own name rather than its path, because every phase of one
 * plan sits in one folder and the folder says nothing that tells them apart.
 */
export const PhaseList = ({ steps, linksDisabled = false }: Props) => {
	const phases = steps.filter((step) => step.childRunId !== undefined);

	return phases.length === 0 ? null : (
		<ul className="flex flex-col gap-1">
			{phases.map((step) => (
				<li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
					<span className="font-medium font-mono">{step.planPath?.split('/').pop() ?? step.id}</span>
					<StatusBadge status={step.status} config={statusBadgeConfig} />
					{step.childRunId === undefined ? null : <ChildRunLink runId={step.childRunId} linksDisabled={linksDisabled} />}
				</li>
			))}
		</ul>
	);
};
