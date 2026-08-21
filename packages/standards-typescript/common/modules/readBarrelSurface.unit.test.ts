import { describe, expect, test } from '@jest/globals';
import { readBarrelSurface } from './readBarrelSurface.ts';

/** One barrel, the files around it, and the tsconfig that places the package. */
const setupBarrel = ({ text, tsconfig }: { text: string; tsconfig?: string }) => ({
	barrelPath: 'packages/engine/src/agents/index.ts',
	contents: new Map([
		['packages/engine/src/agents/index.ts', text],
		...(tsconfig === undefined ? [] : ([['packages/engine/tsconfig.json', tsconfig]] as Array<[string, string]>)),
	]),
	files: new Set([
		'packages/engine/src/agents/index.ts',
		'packages/engine/src/agents/buildSupervisorInvocation.ts',
		'packages/engine/src/agents/formatFindingText.ts',
	]),
});

const aliasConfig = '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }';

describe('readBarrelSurface', () => {
	test('collects the files an aliased barrel re-exports, and calls the surface complete', () => {
		const { barrelPath, contents, files } = setupBarrel({
			text: [
				"export { buildSupervisorInvocation } from '@/agents/buildSupervisorInvocation';",
				"export { formatFindingText } from '@/agents/formatFindingText';",
			].join('\n'),
			tsconfig: aliasConfig,
		});

		const surface = readBarrelSurface({ barrelPath, contents, files });

		expect(surface).toStrictEqual({
			targets: new Set(['packages/engine/src/agents/buildSupervisorInvocation.ts', 'packages/engine/src/agents/formatFindingText.ts']),
			complete: true,
		});
	});

	test('a re-export from a published package leaves the surface complete — it is read, and simply names no local file', () => {
		const { barrelPath, contents, files } = setupBarrel({
			text: ["export { buildSupervisorInvocation } from '@/agents/buildSupervisorInvocation';", "export { z } from 'zod';"].join('\n'),
			tsconfig: aliasConfig,
		});

		const surface = readBarrelSurface({ barrelPath, contents, files });

		expect(surface).toStrictEqual({
			targets: new Set(['packages/engine/src/agents/buildSupervisorInvocation.ts']),
			complete: true,
		});
	});

	test('a barrel whose aliases were never supplied is incomplete, not empty', () => {
		const { barrelPath, contents, files } = setupBarrel({
			text: "export { buildSupervisorInvocation } from '@/agents/buildSupervisorInvocation';",
		});

		const surface = readBarrelSurface({ barrelPath, contents, files });

		expect(surface).toStrictEqual({ targets: new Set(), complete: false });
	});

	test('one unresolvable line is enough to make the whole surface incomplete', () => {
		const { barrelPath, contents, files } = setupBarrel({
			text: ["export { buildSupervisorInvocation } from '@/agents/buildSupervisorInvocation';", "export { gone } from './gone';"].join('\n'),
			tsconfig: aliasConfig,
		});

		const surface = readBarrelSurface({ barrelPath, contents, files });

		expect(surface).toStrictEqual({
			targets: new Set(['packages/engine/src/agents/buildSupervisorInvocation.ts']),
			complete: false,
		});
	});

	test('follows a line pointing at another barrel through to the file behind it', () => {
		const contents = new Map<string, string>([
			['packages/engine/src/contracts/index.ts', "export { Row } from '@/contracts/rows/index.ts';"],
			['packages/engine/src/contracts/rows/index.ts', "export { Row } from '@/contracts/rows/Row.ts';"],
			['packages/engine/tsconfig.json', aliasConfig],
		]);
		const files = new Set([
			'packages/engine/src/contracts/index.ts',
			'packages/engine/src/contracts/rows/index.ts',
			'packages/engine/src/contracts/rows/Row.ts',
		]);

		const surface = readBarrelSurface({ barrelPath: 'packages/engine/src/contracts/index.ts', contents, files });

		// stopping at the first hop records the middle barrel as the public thing
		// and Row.ts as private, which is how 54 published files were reported as
		// unpublished the day their folders became visible
		expect(surface).toStrictEqual({
			targets: new Set(['packages/engine/src/contracts/rows/index.ts', 'packages/engine/src/contracts/rows/Row.ts']),
			complete: true,
		});
	});

	test('a nested barrel whose own text is out of scope leaves the surface incomplete', () => {
		const contents = new Map<string, string>([
			['packages/engine/src/contracts/index.ts', "export { Row } from '@/contracts/rows/index.ts';"],
			['packages/engine/tsconfig.json', aliasConfig],
		]);
		const files = new Set(['packages/engine/src/contracts/index.ts', 'packages/engine/src/contracts/rows/index.ts']);

		const surface = readBarrelSurface({ barrelPath: 'packages/engine/src/contracts/index.ts', contents, files });

		// unread is not empty: a rule arguing a file is absent has to stand down
		expect(surface.complete).toBe(false);
	});

	test('two barrels that re-export each other terminate instead of recurring forever', () => {
		const contents = new Map<string, string>([
			['packages/engine/src/a/index.ts', "export { Row } from '@/b/index.ts';"],
			['packages/engine/src/b/index.ts', "export { Row } from '@/a/index.ts';"],
			['packages/engine/tsconfig.json', aliasConfig],
		]);
		const files = new Set(['packages/engine/src/a/index.ts', 'packages/engine/src/b/index.ts']);

		const surface = readBarrelSurface({ barrelPath: 'packages/engine/src/a/index.ts', contents, files });

		expect(surface.targets).toStrictEqual(new Set(['packages/engine/src/b/index.ts', 'packages/engine/src/a/index.ts']));
	});

	test('a barrel with no re-export lines at all is complete and empty, which is a real answer', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: 'export const version = 1;', tsconfig: aliasConfig });

		const surface = readBarrelSurface({ barrelPath, contents, files });

		expect(surface).toStrictEqual({ targets: new Set(), complete: true });
	});
});
