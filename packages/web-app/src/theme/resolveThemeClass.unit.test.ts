import { afterEach, describe, expect, test } from '@jest/globals';
import { ResolvedTheme } from '#src/common/constants/ResolvedTheme.ts';
import { Theme } from '#src/common/constants/Theme.ts';
import { resolveThemeClass } from '#src/theme/resolveThemeClass.ts';

/**
 * jsdom implements no `matchMedia`, which is exactly the case this function has
 * to answer for — so the test that needs one installs it and nothing else does.
 */
const setupResolveThemeClass = ({ systemPrefersDark }: { systemPrefersDark?: boolean } = {}) => {
	if (systemPrefersDark !== undefined) {
		Object.assign(globalThis, { matchMedia: () => ({ matches: systemPrefersDark }) });
	}
};

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'matchMedia');
});

describe('resolveThemeClass', () => {
	test('renders light for a reader who chose light', () => {
		setupResolveThemeClass();

		const resolved = resolveThemeClass({ theme: Theme.Light });

		expect(resolved).toBe(ResolvedTheme.Light);
	});

	test('renders dark for a reader who chose dark', () => {
		setupResolveThemeClass();

		const resolved = resolveThemeClass({ theme: Theme.Dark });

		expect(resolved).toBe(ResolvedTheme.Dark);
	});

	test('follows a system set to dark', () => {
		setupResolveThemeClass({ systemPrefersDark: true });

		const resolved = resolveThemeClass({ theme: Theme.System });

		expect(resolved).toBe(ResolvedTheme.Dark);
	});

	test('follows a system set to light', () => {
		setupResolveThemeClass({ systemPrefersDark: false });

		const resolved = resolveThemeClass({ theme: Theme.System });

		expect(resolved).toBe(ResolvedTheme.Light);
	});

	test('answers dark where the system cannot be asked, which is what makes the server render match the client', () => {
		setupResolveThemeClass();

		const resolved = resolveThemeClass({ theme: Theme.System });

		expect(resolved).toBe(ResolvedTheme.Dark);
	});
});
