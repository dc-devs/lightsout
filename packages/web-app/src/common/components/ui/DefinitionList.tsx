import type { DefinitionEntry } from '#src/common/types/DefinitionEntry.ts';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	/** Each row's term and its value, in the order they should read. */
	entries: DefinitionEntry[];
	className?: string;
}

/**
 * A boxed list of term-and-value rows — a plan's front matter, a rule's
 * settings.
 *
 * Each pair is wrapped in a `display: contents` element so it carries one key
 * without breaking the two-column grid the `dl` itself lays out. Values are
 * nodes rather than strings because a value is sometimes marked up: a path in
 * monospace, a severity with a note about where it came from.
 */
export const DefinitionList = ({ entries, className }: Props) => (
	<dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted px-3 py-2 text-xs', className)}>
		{entries.map(([term, value]) => (
			<div key={term} className="contents">
				<dt className="font-medium">{term}</dt>
				<dd>{value}</dd>
			</div>
		))}
	</dl>
);
