import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
	icon?: LucideIcon;
	title: string;
	description?: ReactNode;
	/** Right-aligned slot — a filter, a copy button, a count. */
	action?: ReactNode;
}

/** Every page's opening row: what this page is, and the one control that belongs beside its name. */
export const PageHeader = ({ icon: Icon, title, description, action }: Props) => (
	<header className="flex flex-wrap items-start justify-between gap-3">
		<div className="flex min-w-0 flex-col gap-1">
			<div className="flex items-center gap-2">
				{Icon === undefined ? null : <Icon aria-hidden="true" className="size-5 text-muted-foreground" />}
				<h1 className="font-semibold text-2xl">{title}</h1>
			</div>
			{description === undefined ? null : <p className="text-muted-foreground text-sm">{description}</p>}
		</div>
		{action}
	</header>
);
