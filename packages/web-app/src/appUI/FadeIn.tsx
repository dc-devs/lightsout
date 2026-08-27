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
 * It renders **visible**, and only the browser ever hides anything. A page that
 * arrives without its scripts — an error, a slow network, a reader who blocks
 * them — is a page whose words are on screen, because the reveal is decoration
 * and decoration must never be what puts the content there. Rendering hidden
 * and waiting for an effect is how that promise gets broken, and the server has
 * no way to know whether the effect will ever run.
 *
 * So the hiding happens on mount, and only for children that are off screen at
 * that moment: those cost nobody a flash, since there was nothing to see. Any
 * section already in view simply stays as it arrived. A viewer who asked for
 * reduced motion, and any browser without an `IntersectionObserver`, is never
 * hidden at all.
 */
export const FadeIn = ({ children, delayMs = 0, className }: Props) => {
	const [hidden, setHidden] = useState(false);
	const element = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const reduced = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const target = element.current;

		if (reduced || typeof globalThis.IntersectionObserver !== 'function' || target === null) {
			return;
		}

		const box = target.getBoundingClientRect();

		// On screen already: leave it exactly as it was served. Hiding it here is
		// the one thing a reader would see as a flicker.
		if (box.top < globalThis.innerHeight && box.bottom > 0) {
			return;
		}

		setHidden(true);

		const observer = new globalThis.IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setHidden(false);
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
			className={cn('transition-all duration-700 ease-out', hidden ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100', className)}
		>
			{children}
		</div>
	);
};
