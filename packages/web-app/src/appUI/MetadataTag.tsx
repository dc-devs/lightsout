import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	children: ReactNode;
	className?: string;
	/** Native tooltip, for a value the tag has to truncate. */
	title?: string;
}

/**
 * An inline mono micro-tag for machine truth — a run id, a step id, a rule id,
 * a file path, a package name.
 *
 * Mono is reserved for values a reader would type or paste somewhere else, so
 * the face itself is the signal that this is an identifier rather than prose.
 */
export const MetadataTag = ({ children, className, title }: Props) => (
	<span
		title={title}
		className={cn(
			'inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground-strong',
			className,
		)}
	>
		{children}
	</span>
);
