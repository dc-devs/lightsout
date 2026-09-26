import { GridPattern } from '#src/common/constants/GridPattern.ts';
import { cn } from '#src/common/utils/cn.ts';

/** Each pattern as a CSS background, drawn in the theme's border colour so it follows light and dark. */
const patternImages: Record<GridPattern, { backgroundImage: string; backgroundSize?: string }> = {
	[GridPattern.Lines]: {
		backgroundImage:
			'repeating-linear-gradient(0deg, var(--border) 0 1px, transparent 1px 64px), repeating-linear-gradient(90deg, var(--border) 0 1px, transparent 1px 64px)',
	},
	// FeedbackDrop's hero grid: hairlines every 40px in the muted tone.
	[GridPattern.Squares]: {
		backgroundImage: 'linear-gradient(to right, var(--muted) 1px, transparent 1px), linear-gradient(to bottom, var(--muted) 1px, transparent 1px)',
		backgroundSize: '40px 40px',
	},
};

/** Fades the wash out toward every edge from the centre. */
const centreFade = 'radial-gradient(ellipse at center, black 20%, transparent 75%)';

interface Props {
	/** Ruled lines unless a section asks for another pattern. */
	pattern?: GridPattern;
	/** Where the wash fades to nothing, as a CSS mask; from the centre outward unless a section says otherwise. */
	maskImage?: string;
	className?: string;
}

/**
 * The faint graph-paper wash behind a marketing section.
 *
 * Decoration and nothing else: hidden from assistive technology, drawn in the
 * theme's own border colour so it follows light and dark without a literal, and
 * masked to nothing at the edges so it never draws a hard line across a section.
 */
export const GridBackground = ({ pattern = GridPattern.Lines, maskImage = centreFade, className }: Props) => (
	<div
		aria-hidden="true"
		style={{
			...patternImages[pattern],
			maskImage,
			WebkitMaskImage: maskImage,
		}}
		className={cn('pointer-events-none absolute inset-0 opacity-60', className)}
	/>
);
