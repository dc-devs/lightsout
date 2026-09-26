import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	/** Words, or words with logos inline beside the names they belong to. */
	label: ReactNode;
	/** A blue icon before the label. */
	icon?: LucideIcon;
	className?: string;
}

/**
 * The white pill with a blue icon and uppercase label that opens a home
 * section — FeedbackDrop's section badge, so the two sites introduce a section
 * the same way.
 */
export const SectionPill = ({ icon: Icon, label, className }: Props) => (
	<p
		className={cn(
			'inline-flex items-center gap-2 rounded-full border border-primary-tint-border bg-card px-4 py-2 font-semibold text-primary-hover text-sm tracking-wide',
			className,
		)}
	>
		{Icon === undefined ? null : <Icon aria-hidden="true" className="size-4" />}
		<span className="inline-flex items-center gap-1.5 uppercase">{label}</span>
	</p>
);
