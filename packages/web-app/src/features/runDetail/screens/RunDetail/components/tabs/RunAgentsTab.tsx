import { PipelineKind } from '@lightsout/engine/contracts';
import type { RunDetailView } from '#src/features/runDetail/common/types/RunDetailView.ts';
import { AgentCostPanel } from '#src/features/runDetail/screens/RunDetail/components/AgentCostPanel.tsx';
import { CoordinatorNote } from '#src/features/runDetail/screens/RunDetail/components/CoordinatorNote.tsx';

interface Props {
	view: RunDetailView;
}

/** What the agents cost: the run total, the split per step, and every invocation the ledger recorded. */
export const RunAgentsTab = ({ view }: Props) =>
	view.listing.pipeline === PipelineKind.Phases ? (
		<CoordinatorNote />
	) : (
		<AgentCostPanel usage={view.usage} cacheReadShare={view.cacheReadShare} steps={view.steps} agents={view.agents} rejectedReports={view.rejectedReports} />
	);
