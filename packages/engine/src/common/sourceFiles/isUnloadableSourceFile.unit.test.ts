import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { isUnloadableSourceFile } from '#src/common/sourceFiles/isUnloadableSourceFile.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';

const setup = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-unloadable-'));

	linkTypescript({ dir });

	const compiler = resolveConsumerTypescript({ cwd: dir });

	if (compiler === undefined) {
		throw new Error('the linked typescript must resolve');
	}

	return { compiler };
};

test('isUnloadableSourceFile: an await at module scope makes the file unloadable', () => {
	const { compiler } = setup();

	// The shape of the engine's own CLI entry: a call awaited at module scope.
	expect(isUnloadableSourceFile({ path: 'src/main.ts', content: "import { main } from './cli';\n\nawait main();\n", compiler })).toBe(true);
	// Nested inside a module-scope expression rather than a bare statement.
	expect(isUnloadableSourceFile({ path: 'src/main.ts', content: 'const config = (await load()).value;\n', compiler })).toBe(true);
	// `for await (… of …)` carries its await on the statement, not an expression.
	expect(isUnloadableSourceFile({ path: 'src/stream.ts', content: 'for await (const chunk of source) {\n\tconsume(chunk);\n}\n', compiler })).toBe(true);
	// Inside a module-scope block, still module scope.
	expect(isUnloadableSourceFile({ path: 'src/block.ts', content: '{\n\tawait ready();\n}\n', compiler })).toBe(true);
});

test('isUnloadableSourceFile: an await inside a function or class body is ordinary async code', () => {
	const { compiler } = setup();

	expect(isUnloadableSourceFile({ path: 'src/run.ts', content: 'export const run = async () => {\n\tawait step();\n};\n', compiler })).toBe(false);
	expect(isUnloadableSourceFile({ path: 'src/run.ts', content: 'export async function run() {\n\tawait step();\n}\n', compiler })).toBe(false);
	expect(isUnloadableSourceFile({ path: 'src/Runner.ts', content: 'export class Runner {\n\tasync run() {\n\t\tawait this.step();\n\t}\n}\n', compiler })).toBe(
		false,
	);
	// An async function merely DECLARED at module scope does not await at module scope.
	expect(isUnloadableSourceFile({ path: 'src/main.ts', content: 'const main = async () => {\n\tawait go();\n};\n\nmain();\n', compiler })).toBe(false);
});

test('isUnloadableSourceFile: a file with no await at all is loadable', () => {
	const { compiler } = setup();

	expect(isUnloadableSourceFile({ path: 'src/add.ts', content: 'export const add = (a: number, b: number): number => a + b;\n', compiler })).toBe(false);
	expect(isUnloadableSourceFile({ path: 'src/empty.ts', content: '', compiler })).toBe(false);
});

test('isUnloadableSourceFile: a .tsx or .jsx file is parsed as JSX, so its module-scope await is still found', () => {
	const { compiler } = setup();

	expect(isUnloadableSourceFile({ path: 'src/App.tsx', content: 'const view = <App label="hi" />;\n\nawait render(view);\n', compiler })).toBe(true);
	expect(isUnloadableSourceFile({ path: 'src/App.jsx', content: 'const view = <App label="hi" />;\n\nawait render(view);\n', compiler })).toBe(true);
	// JSX that only surrounds ordinary async code says nothing about loading.
	expect(
		isUnloadableSourceFile({ path: 'src/App.tsx', content: 'export const App = async () => {\n\tawait load();\n\n\treturn <div />;\n};\n', compiler }),
	).toBe(false);
});
