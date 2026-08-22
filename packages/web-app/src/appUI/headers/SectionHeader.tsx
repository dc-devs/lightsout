import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	title: ReactNode;
	description?: ReactNode;
	/** Right-aligned slot on the heading row. */
	action?: ReactNode;
	className?: string;
}

/** A sub-section heading inside a page or a tab — one level down from `PageHeader`. */
export const SectionHeader = ({ title, description, action, className }: Props) => (
	<div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
		<div className="flex min-w-0 flex-col gap-1">
			<h2 className="font-semibold text-base">{title}</h2>
			{description === undefined ? null : <p className="text-muted-foreground text-sm">{description}</p>}
		</div>
		{action}
	</div>
);
