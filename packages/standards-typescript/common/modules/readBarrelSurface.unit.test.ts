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

	test('a barrel with no re-export lines at all is complete and empty, which is a real answer', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: 'export const version = 1;', tsconfig: aliasConfig });

		const surface = readBarrelSurface({ barrelPath, contents, files });

		expect(surface).toStrictEqual({ targets: new Set(), complete: true });
	});
});
