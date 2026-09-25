import { PipelineKind } from '@lightsout/engine/contracts';
import type { RunDetailView } from '#src/features/runDetail/internal/common/types/RunDetailView.ts';
import { CoordinatorNote } from '#src/features/runDetail/screens/RunDetail/internal/components/CoordinatorNote.tsx';
import { GateEvidencePanel } from '#src/features/runDetail/screens/RunDetail/internal/components/GateEvidencePanel.tsx';

interface Props {
	view: RunDetailView;
}

/** Every gate command the run ran, each said against the step it ran under. */
export const RunGatesTab = ({ view }: Props) =>
	view.listing.pipeline === PipelineKind.Phases ? <CoordinatorNote /> : <GateEvidencePanel gates={view.gates} totals={view.gateTotals} showStep />;
