import { FileText } from 'lucide-react';

interface Props {
	/** Repo-relative path the drawer will show. */
	path: string;
	/** Names which document this is when a card shows more than one — omitted, the path speaks for itself. */
	label?: string;
	onOpenPlan: (path: string) => void;
}

/** A recorded plan path, rendered as the control that opens it in the drawer. */
export const PlanPathButton = ({ path, label, onOpenPlan }: Props) => (
	<button
		type="button"
		onClick={() => onOpenPlan(path)}
		className="flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-muted-foreground-strong text-xs transition-colors hover:bg-accent hover:text-foreground"
	>
		<FileText className="size-3.5" />
		{label === undefined ? path : `${label}: ${path}`}
	</button>
);
