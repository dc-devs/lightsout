import type { ReactNode } from 'react';

interface Props {
	children: ReactNode;
}

/** The small uppercase eyebrow above a section heading — what this section is about, in two words. */
export const SectionBadge = ({ children }: Props) => (
	<span className="inline-flex items-center rounded-sm border border-border bg-muted px-2 py-0.5 font-medium text-[0.7rem] text-muted-foreground-strong uppercase tracking-widest">
		{children}
	</span>
);
