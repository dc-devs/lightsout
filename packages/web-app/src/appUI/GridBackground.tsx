import { cn } from '#src/common/utils/cn.ts';

interface Props {
	className?: string;
}

/**
 * The faint graph-paper wash behind a marketing section.
 *
 * Decoration and nothing else: hidden from assistive technology, drawn in the
 * theme's own border colour so it follows light and dark without a literal, and
 * masked to nothing at the edges so it never draws a hard line across a section.
 */
export const GridBackground = ({ className }: Props) => (
	<div
		aria-hidden="true"
		style={{
			backgroundImage:
				'repeating-linear-gradient(0deg, var(--border) 0 1px, transparent 1px 64px), repeating-linear-gradient(90deg, var(--border) 0 1px, transparent 1px 64px)',
			maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 75%)',
			WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 75%)',
		}}
		className={cn('pointer-events-none absolute inset-0 opacity-60', className)}
	/>
);
