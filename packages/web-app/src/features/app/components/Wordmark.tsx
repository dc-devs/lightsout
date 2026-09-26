import { Link } from '@tanstack/react-router';
import { Lightbulb } from 'lucide-react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	className?: string;
}

/**
 * The product's mark and name, linking home.
 *
 * FeedbackDrop's logo, class for class, with the bulb in place of its drop: the
 * icon in the primary colour, the name beside it, and a small pill saying what
 * stage the product is at. One component for both bars, so the site header and
 * the app's bar cannot drift into two logos. The bulb is decoration: the name
 * is the link's name.
 */
export const Wordmark = ({ className }: Props) => (
	<Link to="/" aria-label="lightsout" className={cn('inline-flex items-baseline gap-2', className)}>
		<Lightbulb aria-hidden="true" size={20} className="relative -top-px self-center text-primary" />
		<span className="font-semibold text-lg">lightsout</span>
		<span className="self-center rounded-full border border-primary-tint-border/50 bg-primary-tint px-2 py-0.5 font-bold text-[10px] text-primary uppercase tracking-widest">
			Alpha
		</span>
	</Link>
);
