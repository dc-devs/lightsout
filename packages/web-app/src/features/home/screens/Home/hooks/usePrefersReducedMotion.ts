import { useEffect, useState } from 'react';

/**
 * Whether the reader asked their system for less motion.
 *
 * Read in an effect, so the server render and the first client render agree —
 * both assume motion — and a browser without `matchMedia` is treated as one
 * that never asked.
 */
export const usePrefersReducedMotion = (): boolean => {
	const [prefersReduced, setPrefersReduced] = useState(false);

	useEffect(() => {
		if (typeof globalThis.matchMedia === 'function') {
			setPrefersReduced(globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
		}
	}, []);

	return prefersReduced;
};
