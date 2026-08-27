import type { PlanWorkspaceView } from '@lightsout/engine';
import { PlanDocumentBody } from '#src/features/plans/screens/PlanDetail/components/PlanDocumentBody.tsx';

interface Props {
	view: PlanWorkspaceView;
}

/** The rough idea `/brainstorm` wrote down before any of this was a plan. */
export const NotesTab = ({ view }: Props) =>
	view.notesFile === undefined ? (
		<p className="text-muted-foreground text-sm">No notes — /brainstorm writes them when a plan starts from a rough idea.</p>
	) : (
		<PlanDocumentBody path={view.notesFile.path} />
	);
