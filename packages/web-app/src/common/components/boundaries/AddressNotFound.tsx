import type { ReactNode } from 'react';

interface Props {
	/** The headline: what kind of thing the path named and could not be found. */
	title: string;
	/** The sentence under it, which is where the id itself is quoted. */
	children: ReactNode;
}

/**
 * The panel a detail route renders when the id in its path names nothing.
 *
 * Distinct from `NotFound`, which answers a path the router itself does not
 * recognise. This one answers a path that is well-formed and whose subject is
 * simply absent, so the caller supplies both the headline and the sentence that
 * quotes the id — the reader's next move is to pick a different one from the
 * list, not to go home.
 */
export const AddressNotFound = ({ title, children }: Props) => (
	<div className="flex h-full flex-col items-start justify-center gap-2 p-10">
		<h1 className="font-semibold text-lg">{title}</h1>
		<p className="text-muted-foreground text-sm">{children}</p>
	</div>
);
