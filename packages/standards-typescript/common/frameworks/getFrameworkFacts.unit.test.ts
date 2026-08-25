import { describe, expect, test } from '@jest/globals';
import { getFrameworkFacts } from './getFrameworkFacts.ts';

/** Declared dependency names per package directory, exactly as the engine reads them off the manifests. */
const setupDependencies = ({ packages }: { packages: Array<[string, string[]]> }) => new Map(packages);

describe('getFrameworkFacts', () => {
	test('a repo declaring a file router answers for its route files and nothing else', () => {
		const facts = getFrameworkFacts({ dependencies: setupDependencies({ packages: [['.', ['@tanstack/react-router']]] }) });

		expect(facts.isFrameworkLoadedFile({ path: 'src/routes/index.tsx' })).toBe(true);
		expect(facts.isFrameworkLoadedFile({ path: 'src/features/app/RunsIndex.tsx' })).toBe(false);
	});

	test('a repo declaring nothing the table knows loads no file by itself', () => {
		const facts = getFrameworkFacts({ dependencies: setupDependencies({ packages: [['.', ['zod', 'typescript']]] }) });

		expect(facts.isFrameworkLoadedFile({ path: 'src/routes/index.tsx' })).toBe(false);
		expect(facts.isFrameworkLoadedFile({ path: 'src/features/app/RunsIndex.tsx' })).toBe(false);
	});

	test('a workspace package’s dependency governs its own src only', () => {
		const facts = getFrameworkFacts({
			dependencies: setupDependencies({
				packages: [
					['.', []],
					['packages/web', ['@tanstack/react-start']],
					['packages/api', []],
				],
			}),
		});

		expect(facts.isFrameworkLoadedFile({ path: 'packages/web/src/routes/index.tsx' })).toBe(true);
		expect(facts.isFrameworkLoadedFile({ path: 'packages/web/src/router.tsx' })).toBe(true);
		expect(facts.isFrameworkLoadedFile({ path: 'packages/api/src/routes/index.tsx' })).toBe(false);
		expect(facts.isFrameworkLoadedFile({ path: 'packages/api/src/router.tsx' })).toBe(false);
	});
});
