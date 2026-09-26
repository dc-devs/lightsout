import { afterEach, describe, expect, test } from '@jest/globals';
import { renderHook } from '@testing-library/react';
import { usePrefersReducedMotion } from '#src/features/home/screens/Home/internal/hooks/usePrefersReducedMotion.ts';

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'matchMedia');
});

describe('usePrefersReducedMotion', () => {
	test('assumes motion is fine in a browser that cannot be asked', () => {
		const { result } = renderHook(() => usePrefersReducedMotion());

		expect(result.current).toBe(false);
	});

	test.each([true, false])('reports %s when the system says so', (matches) => {
		Object.assign(globalThis, { matchMedia: () => ({ matches }) });

		const { result } = renderHook(() => usePrefersReducedMotion());

		expect(result.current).toBe(matches);
	});
});
