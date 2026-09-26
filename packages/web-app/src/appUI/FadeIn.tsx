import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface Props {
	children: ReactNode;
	/** Stagger in ms; default 0. */
	delayMs?: number;
	className?: string;
}

/**
 * Eases its children in — rising 30px and fading up over 0.8s, FeedbackDrop's
 * motion — as the page loads, or as they scroll into view.
 *
 * It renders **visible**, and only the browser ever hides anything. A page that
 * arrives without its scripts — an error, a slow network, a reader who blocks
 * them — is a page whose words are on screen, because the reveal is decoration
 * and decoration must never be what puts the content there. Rendering hidden
 * and waiting for an effect is how that promise gets broken, and the server has
 * no way to know whether the effect will ever run.
 *
 * So what is on screen at load eases in through CSS alone: `@starting-style`
 * (Tailwind's `starting:` variant) gives the transition a place to start from,
 * so no script decides when it shows. Children off screen at mount are hidden
 * by the effect and revealed as they scroll in — those cost nobody a flash,
 * since there was nothing to see. A viewer who asked for reduced motion gets
 * neither, and a browser without an `IntersectionObserver` is never hidden.
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

		// FeedbackDrop's trigger: a sliver of the block in view, a little above the
		// bottom edge, so it rises as the reader reaches it rather than off screen.
		const observer = new globalThis.IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setHidden(false);
					observer.disconnect();
				}
			},
			{ threshold: 0.15, rootMargin: '0px 0px -100px 0px' },
		);

		observer.observe(target);

		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={element}
			style={{ transitionDelay: `${delayMs}ms` }}
			className={cn(
				'transition-all duration-800 ease-out motion-safe:starting:translate-y-[30px] motion-safe:starting:opacity-0',
				hidden ? 'translate-y-[30px] opacity-0' : 'translate-y-0 opacity-100',
				className,
			)}
		>
			{children}
		</div>
	);
};
