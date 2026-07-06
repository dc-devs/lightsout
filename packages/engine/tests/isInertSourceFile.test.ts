import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { isInertSourceFile } from '../src/pipeline/isInertSourceFile';

// Runtime require, mirroring resolveConsumerTypescript: a static import would
// make esbuild inline the whole CJS compiler into the ESM test bundle, where
// its __filename probes crash.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

const inert = (path: string, content: string) => isInertSourceFile({ path, content, compiler: ts });

test('isInertSourceFile: barrels and type-only files are inert', () => {
	assert.equal(inert('src/index.ts', `export * from './a';\nexport { b } from './b';\n`), true, 'barrel');
	assert.equal(inert('src/index.ts', `export type { Shape } from './Shape';\n`), true, 'type re-export barrel');
	assert.equal(
		inert('src/Shape.ts', `import type { Base } from './Base';\n\nexport interface Shape extends Base {\n\tid: number;\n}\n\nexport type Kind = 'a' | 'b';\n`),
		true,
		'type-only file',
	);
	assert.equal(inert('src/index.ts', `import { a } from './a';\n\nexport { a };\n`), true, 'import-then-export barrel');
	assert.equal(inert('src/empty.ts', ''), true, 'empty file');
});

test('isInertSourceFile: anything with executable code keeps its writer', () => {
	assert.equal(inert('src/config.ts', `export const url = process.env.API_URL ?? 'http://localhost';\n`), false, 'constant with fallback logic');
	assert.equal(inert('src/constants.ts', `export const LIMIT = 50;\n`), false, 'plain constant (conservative: still a value)');
	assert.equal(inert('src/Status.ts', `export enum Status {\n\tOpen,\n\tClosed,\n}\n`), false, 'enum has runtime code');
	assert.equal(inert('src/add.ts', `export const add = (a: number, b: number) => a + b;\n`), false, 'function');
	assert.equal(inert('src/main.ts', `export default 42;\n`), false, 'export-default value');
	assert.equal(inert('src/mixed.ts', `export type A = string;\nexport const b = 1;\n`), false, 'mixed type + value');
	assert.equal(inert('src/App.tsx', `export const App = () => <div>hi</div>;\n`), false, 'tsx component parses and has logic');
});
