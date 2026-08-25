import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isFrameworkCasedFolder } from './isFrameworkCasedFolder.ts';

const setupCarveOut = ({
	directory = '.',
	kebabCase = false,
	routerRoots = [],
}: {
	directory?: string;
	kebabCase?: boolean;
	routerRoots?: string[];
} = {}): FrameworkCarveOut => ({
	directory,
	entryFiles: [],
	exemptFolderNames: [],
	kebabCase,
	routerRoots,
	moduleFolders: [],
});

describe('isFrameworkCasedFolder', () => {
	test('a package whose framework mandates kebab-case owns every folder’s casing', () => {
		const carveOut = setupCarveOut({ kebabCase: true });

		expect(isFrameworkCasedFolder({ folder: 'src/events/event-handlers', carveOut })).toBe(true);
		expect(isFrameworkCasedFolder({ folder: 'src/events', carveOut })).toBe(true);
	});

	test('a folder under a router root is kebab-case by mandate, its segments being URL path segments', () => {
		const carveOut = setupCarveOut({ routerRoots: ['routes'] });

		expect(isFrameworkCasedFolder({ folder: 'src/routes/run-details', carveOut })).toBe(true);
	});

	test('a folder that is neither is the author’s to case', () => {
		const carveOut = setupCarveOut({ routerRoots: ['routes'] });

		expect(isFrameworkCasedFolder({ folder: 'src/features/run-details', carveOut })).toBe(false);
		// `routes` at arbitrary depth is an ordinary domain folder, not the router's
		expect(isFrameworkCasedFolder({ folder: 'src/features/routes/run-details', carveOut })).toBe(false);
	});

	test('outside the governing package’s src, the router half earns nothing', () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app', routerRoots: ['routes'] });

		expect(isFrameworkCasedFolder({ folder: 'packages/web-app/fixtures/routes/run-details', carveOut })).toBe(false);
	});
});
