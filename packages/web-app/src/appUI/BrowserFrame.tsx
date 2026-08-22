import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	/** Shown in the address bar; mono. */
	url: string;
	children: ReactNode;
	className?: string;
}

/**
 * Browser chrome around arbitrary children — three dots, an address bar, and a
 * clipped body.
 *
 * The body makes every link inside it inert, which is what lets the real run
 * components be shown as a demo: the page renders the product rather than a
 * picture of it, and a click still cannot navigate out of the section.
 */
export const BrowserFrame = ({ url, children, className }: Props) => (
	<div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
		<div className="flex items-center gap-3 border-border border-b bg-muted px-3 py-2">
			<div aria-hidden="true" className="flex shrink-0 gap-1.5">
				<span className="size-2.5 rounded-full bg-status-failed" />
				<span className="size-2.5 rounded-full bg-status-running" />
				<span className="size-2.5 rounded-full bg-status-passed" />
			</div>
			<span className="min-w-0 flex-1 truncate rounded-sm bg-background px-2 py-0.5 font-mono text-[0.7rem] text-muted-foreground">{url}</span>
		</div>
		<div className="[&_a]:pointer-events-none">{children}</div>
	</div>
);
