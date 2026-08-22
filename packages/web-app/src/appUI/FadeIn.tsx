import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	children: ReactNode;
	/** Stagger in ms; default 0. */
	delayMs?: number;
	className?: string;
}

/**
 * Reveals its children once they scroll into view.
 *
 * A viewer who asked their system for reduced motion, and any browser without
 * an `IntersectionObserver`, gets the content at once rather than a transition
 * — the reveal is decoration, so its absence must never cost anyone the words.
 */
export const FadeIn = ({ children, delayMs = 0, className }: Props) => {
	const [visible, setVisible] = useState(false);
	const element = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const reduced = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const target = element.current;

		if (reduced || typeof globalThis.IntersectionObserver !== 'function' || target === null) {
			setVisible(true);

			return;
		}

		const observer = new globalThis.IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setVisible(true);
				observer.disconnect();
			}
		});

		observer.observe(target);

		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={element}
			style={{ transitionDelay: `${delayMs}ms` }}
			className={cn('transition-all duration-700 ease-out', visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0', className)}
		>
			{children}
		</div>
	);
};
