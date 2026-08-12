import { describe, expect, test } from '@jest/globals';
import { readBarrelExports } from './readBarrelExports.ts';

/**
 * One barrel and the files around it, as a file-text rule hands them over. The
 * tsconfig is part of that: it is what tells an aliased re-export from a
 * package one, so every case supplies it the way a run does.
 */
const setupBarrel = ({
	text,
	paths = ['src/feature/index.ts', 'src/feature/renderGreeting.ts'],
	aliasesKnown = true,
}: {
	text: string;
	paths?: string[];
	/** False leaves the run with no tsconfig above the barrel, which is what makes its aliases unknowable. */
	aliasesKnown?: boolean;
}) => ({
	barrelPath: 'src/feature/index.ts',
	contents: new Map<string, string>([
		['src/feature/index.ts', text],
		...(aliasesKnown ? ([['tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }']] as Array<[string, string]>) : []),
	]),
	files: new Set(paths),
});

describe('readBarrelExports', () => {
	test('reads a named re-export as the name it publishes and the file it points at', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export { renderGreeting } from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([
			{ names: ['renderGreeting'], star: false, specifier: './renderGreeting', target: { kind: 'file', path: 'src/feature/renderGreeting.ts' } },
		]);
	});

	test('resolves a re-export written through the package alias, which is how the standards require it to be written', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export { renderGreeting } from '@/feature/renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([
			{ names: ['renderGreeting'], star: false, specifier: '@/feature/renderGreeting', target: { kind: 'file', path: 'src/feature/renderGreeting.ts' } },
		]);
	});

	test('marks an `export *` line as a star with no names, since it publishes nothing it wrote down', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export * from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([{ names: [], star: true, specifier: './renderGreeting', target: { kind: 'file', path: 'src/feature/renderGreeting.ts' } }]);
	});

	test('treats a namespaced `export * as` line as a star too', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export * as greetings from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([{ names: [], star: true, specifier: './renderGreeting', target: { kind: 'file', path: 'src/feature/renderGreeting.ts' } }]);
	});

	test('publishes the alias rather than the source name, and drops an inline `type` keyword', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export { renderGreeting as greet, type Greeting } from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([
			{ names: ['greet', 'Greeting'], star: false, specifier: './renderGreeting', target: { kind: 'file', path: 'src/feature/renderGreeting.ts' } },
		]);
	});

	test('reads a type-only re-export line as the type it publishes', () => {
		const { barrelPath, contents, files } = setupBarrel({
			text: "export type { Greeting } from './Greeting';",
			paths: ['src/feature/index.ts', 'src/feature/Greeting.ts'],
		});

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([{ names: ['Greeting'], star: false, specifier: './Greeting', target: { kind: 'file', path: 'src/feature/Greeting.ts' } }]);
	});

	test('drops the empty entry a trailing comma leaves behind', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export { renderGreeting, } from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([
			{ names: ['renderGreeting'], star: false, specifier: './renderGreeting', target: { kind: 'file', path: 'src/feature/renderGreeting.ts' } },
		]);
	});

	test('calls a published package external, which is a read barrel rather than an unread one', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export { z } from 'zod';" });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([{ names: ['z'], star: false, specifier: 'zod', target: { kind: 'external' } }]);
	});

	test('calls every re-export unknown when no tsconfig places the package, rather than reading the barrel as empty', () => {
		const { barrelPath, contents, files } = setupBarrel({ text: "export { renderGreeting } from '@/feature/renderGreeting';", aliasesKnown: false });

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([{ names: ['renderGreeting'], star: false, specifier: '@/feature/renderGreeting', target: { kind: 'unknown' } }]);
	});

	test('ignores every line that is not a re-export — local exports, imports, commented-out entries', () => {
		const { barrelPath, contents, files } = setupBarrel({
			text: ["// export { renderGreeting } from './renderGreeting';", "import { renderGreeting } from './renderGreeting';", 'export const version = 1;'].join(
				'\n',
			),
		});

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([]);
	});

	test('keeps the barrel’s lines in the order they were written', () => {
		const { barrelPath, contents, files } = setupBarrel({
			text: ["export { renderGreeting } from './renderGreeting';", "export * from './buildGreeting';"].join('\n'),
			paths: ['src/feature/index.ts', 'src/feature/renderGreeting.ts', 'src/feature/buildGreeting.ts'],
		});

		const exports = readBarrelExports({ barrelPath, contents, files });

		expect(exports).toStrictEqual([
			{ names: ['renderGreeting'], star: false, specifier: './renderGreeting', target: { kind: 'file', path: 'src/feature/renderGreeting.ts' } },
			{ names: [], star: true, specifier: './buildGreeting', target: { kind: 'file', path: 'src/feature/buildGreeting.ts' } },
		]);
	});
});
