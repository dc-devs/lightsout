import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isUnderRouterRoot } from './isUnderRouterRoot.ts';

const setupCarveOut = ({ directory = '.', routerRoots = ['routes'] }: { directory?: string; routerRoots?: string[] } = {}): FrameworkCarveOut => ({
	directory,
	exemptFolderNames: [],
	kebabCase: false,
	routerRoots,
});

describe('isUnderRouterRoot', () => {
	test('a file directly inside the router directory is under it', () => {
		expect(isUnderRouterRoot({ path: 'src/routes/runs.$runId.tsx', carveOut: setupCarveOut() })).toBe(true);
	});

	test('a file nested deeper inside the router directory is still under it', () => {
		expect(isUnderRouterRoot({ path: 'src/routes/runs/index.tsx', carveOut: setupCarveOut() })).toBe(true);
	});

	test("anchors to the package's own src/, not the workspace root's", () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		expect(isUnderRouterRoot({ path: 'packages/web-app/src/routes/standards.tsx', carveOut })).toBe(true);
	});

	test('a path outside that package is not under its router directory', () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		expect(isUnderRouterRoot({ path: 'packages/engine/src/routes/thing.ts', carveOut })).toBe(false);
	});

	test('a routes folder at arbitrary depth is an ordinary domain folder, not the router', () => {
		expect(isUnderRouterRoot({ path: 'src/features/runs/routes/thing.ts', carveOut: setupCarveOut() })).toBe(false);
	});

	test('a file merely named routes is not the router directory', () => {
		expect(isUnderRouterRoot({ path: 'src/routes.tsx', carveOut: setupCarveOut() })).toBe(false);
	});

	test('a package that declares no router has no directory to exempt', () => {
		expect(isUnderRouterRoot({ path: 'src/routes/thing.ts', carveOut: setupCarveOut({ routerRoots: [] }) })).toBe(false);
	});
});
