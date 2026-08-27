import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
	icon?: LucideIcon;
	title: string;
	description?: ReactNode;
	/** The control that would fill the emptiness — clear the filters, start a run. */
	action?: ReactNode;
}

/**
 * What a list says when it has nothing to show.
 *
 * One component for every such place, so a filtered-to-nothing table and a repo
 * with no runs yet read as the same kind of answer rather than as two different
 * kinds of broken.
 */
export const EmptyState = ({ icon: Icon, title, description, action }: Props) => (
	<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
		{Icon === undefined ? null : <Icon aria-hidden="true" className="size-6 text-muted-foreground" />}
		<p className="font-medium text-sm">{title}</p>
		{description === undefined ? null : <div className="text-muted-foreground text-sm">{description}</div>}
		{action}
	</div>
);
