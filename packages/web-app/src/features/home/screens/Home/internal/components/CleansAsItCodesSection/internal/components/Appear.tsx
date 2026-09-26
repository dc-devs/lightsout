import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	children: ReactNode;
	className?: string;
}

/**
 * Fades its children in and up a little when they first appear — the moment a
 * scene switches to its cleaned-up state.
 *
 * Pure CSS: the element is rendered visible, and `@starting-style` (Tailwind's
 * `starting:` variant) gives the transition a place to start from. No script
 * decides when to show it, so nothing can leave it stuck invisible — a browser
 * without `@starting-style` simply shows it without the fade.
 */
export const Appear = ({ children, className }: Props) => (
	<div className={cn('translate-y-0 opacity-100 transition-all duration-500 ease-out starting:translate-y-2 starting:opacity-0', className)}>{children}</div>
);
