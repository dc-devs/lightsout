import { describe, expect, test } from '@jest/globals';
import { readBarrelExports } from './readBarrelExports.ts';

/** One barrel and the files around it, as a file-text rule hands them over. */
const setupBarrel = ({ text, paths = ['src/feature/index.ts', 'src/feature/renderGreeting.ts'] }: { text: string; paths?: string[] }) => ({
	barrelPath: 'src/feature/index.ts',
	text,
	files: new Set(paths),
});

describe('readBarrelExports', () => {
	test('reads a named re-export as the name it publishes and the file it points at', () => {
		const { barrelPath, text, files } = setupBarrel({ text: "export { renderGreeting } from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([{ names: ['renderGreeting'], star: false, specifier: './renderGreeting', target: 'src/feature/renderGreeting.ts' }]);
	});

	test('marks an `export *` line as a star with no names, since it publishes nothing it wrote down', () => {
		const { barrelPath, text, files } = setupBarrel({ text: "export * from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([{ names: [], star: true, specifier: './renderGreeting', target: 'src/feature/renderGreeting.ts' }]);
	});

	test('treats a namespaced `export * as` line as a star too', () => {
		const { barrelPath, text, files } = setupBarrel({ text: "export * as greetings from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([{ names: [], star: true, specifier: './renderGreeting', target: 'src/feature/renderGreeting.ts' }]);
	});

	test('publishes the alias rather than the source name, and drops an inline `type` keyword', () => {
		const { barrelPath, text, files } = setupBarrel({
			text: "export { renderGreeting as greet, type Greeting } from './renderGreeting';",
		});

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([{ names: ['greet', 'Greeting'], star: false, specifier: './renderGreeting', target: 'src/feature/renderGreeting.ts' }]);
	});

	test('reads a type-only re-export line as the type it publishes', () => {
		const { barrelPath, text, files } = setupBarrel({
			text: "export type { Greeting } from './Greeting';",
			paths: ['src/feature/index.ts', 'src/feature/Greeting.ts'],
		});

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([{ names: ['Greeting'], star: false, specifier: './Greeting', target: 'src/feature/Greeting.ts' }]);
	});

	test('drops the empty entry a trailing comma leaves behind', () => {
		const { barrelPath, text, files } = setupBarrel({ text: "export { renderGreeting, } from './renderGreeting';" });

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([{ names: ['renderGreeting'], star: false, specifier: './renderGreeting', target: 'src/feature/renderGreeting.ts' }]);
	});

	test('leaves the target undefined when the specifier lands outside the files in scope', () => {
		const { barrelPath, text, files } = setupBarrel({ text: "export { z } from 'zod';" });

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([{ names: ['z'], star: false, specifier: 'zod', target: undefined }]);
	});

	test('ignores every line that is not a re-export — local exports, imports, commented-out entries', () => {
		const { barrelPath, text, files } = setupBarrel({
			text: ["// export { renderGreeting } from './renderGreeting';", "import { renderGreeting } from './renderGreeting';", 'export const version = 1;'].join(
				'\n',
			),
		});

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([]);
	});

	test('keeps the barrel’s lines in the order they were written', () => {
		const { barrelPath, text, files } = setupBarrel({
			text: ["export { renderGreeting } from './renderGreeting';", "export * from './buildGreeting';"].join('\n'),
			paths: ['src/feature/index.ts', 'src/feature/renderGreeting.ts', 'src/feature/buildGreeting.ts'],
		});

		const exports = readBarrelExports({ barrelPath, text, files });

		expect(exports).toStrictEqual([
			{ names: ['renderGreeting'], star: false, specifier: './renderGreeting', target: 'src/feature/renderGreeting.ts' },
			{ names: [], star: true, specifier: './buildGreeting', target: 'src/feature/buildGreeting.ts' },
		]);
	});
});
