import type { ReactNode } from 'react';

interface Props {
	label: string;
	value: ReactNode;
	/** The second line — what the headline number is made of. */
	hint?: ReactNode;
	/** A drawing that belongs with the number, such as a sparkline. */
	children?: ReactNode;
}

/**
 * One number on the health page, with the words that say what it counts.
 *
 * The tile takes its value as a node rather than a number so a caller can hand
 * it a dash: "no check has run" and "zero findings" are different facts, and a
 * tile that rendered them both as 0 would be lying about one of them.
 */
export const HealthTile = ({ label, value, hint, children }: Props) => (
	<div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
		<span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
		<span className="font-semibold text-2xl">{value}</span>
		{hint === undefined ? null : <span className="text-muted-foreground text-xs">{hint}</span>}
		{children}
	</div>
);
