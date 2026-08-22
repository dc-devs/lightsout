import type { ReactNode } from 'react';
import { GridBackground } from '#src/appUI/GridBackground.tsx';

interface Props {
	title: ReactNode;
	description?: ReactNode;
	/** The action itself — on Home, the copyable install line. */
	children: ReactNode;
}

/** The full-width closing block of a page: one sentence, and the one thing to do about it. */
export const CtaBanner = ({ title, description, children }: Props) => (
	<section className="relative overflow-hidden rounded-lg border border-border bg-card px-6 py-12">
		<GridBackground />
		<div className="relative flex flex-col items-center gap-4 text-center">
			<h2 className="font-semibold text-2xl">{title}</h2>
			{description === undefined ? null : <p className="max-w-xl text-muted-foreground text-sm">{description}</p>}
			{children}
		</div>
	</section>
);
