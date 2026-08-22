import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	title: ReactNode;
	description?: ReactNode;
	/** Right-aligned slot on the title row — the control the card is about. */
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}

/**
 * A titled panel whose heading carries a sentence of its own, split from its
 * body by a hairline.
 *
 * `Card` puts a bare title over a body; this is the shape a settings row needs,
 * where the explanation of what a value means sits under its name rather than
 * inside the body it describes.
 */
export const SettingsCard = ({ title, description, action, children, className }: Props) => (
	<section className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}>
		<header className="flex flex-wrap items-start justify-between gap-3 border-border border-b px-4 py-3">
			<div className="flex min-w-0 flex-col gap-1">
				<h3 className="font-semibold text-sm">{title}</h3>
				{description === undefined ? null : <p className="text-muted-foreground text-xs">{description}</p>}
			</div>
			{action}
		</header>
		<div className="px-4 py-3">{children}</div>
	</section>
);
