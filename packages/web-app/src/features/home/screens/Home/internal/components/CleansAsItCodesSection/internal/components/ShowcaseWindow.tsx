import type { ReactNode } from 'react';

interface Props {
	/** What the window is showing, in its title bar. */
	title: string;
	children: ReactNode;
}

/** The white app window each animation plays in: three dots and a title, then the scene. */
export const ShowcaseWindow = ({ title, children }: Props) => (
	<div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-blue-900/10">
		<div className="flex items-center gap-3 border-border/60 border-b bg-muted/80 px-5 py-3.5">
			<span aria-hidden="true" className="flex gap-1.5">
				<span className="size-2.5 rounded-full bg-muted-foreground/30" />
				<span className="size-2.5 rounded-full bg-muted-foreground/30" />
				<span className="size-2.5 rounded-full bg-muted-foreground/30" />
			</span>
			<span className="font-mono text-muted-foreground text-xs tracking-wide">{title}</span>
		</div>
		<div className="h-[26rem] p-6 sm:p-8">{children}</div>
	</div>
);
