import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { isInertSourceFile } from '#src/common/sourceFiles/isInertSourceFile.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';

const setup = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-inert-'));

	linkTypescript({ dir });

	const compiler = resolveConsumerTypescript({ cwd: dir });

	if (compiler === undefined) {
		throw new Error('the linked typescript must resolve');
	}

	return { compiler };
};

test.each([
	{ case: 'a barrel of re-exports', path: 'src/barrel.ts', content: "export * from './add';\nexport { Thing } from './Thing';\n" },
	{ case: 'a type-only re-export', path: 'src/types.ts', content: "export type { Feature } from './feature';\n" },
	{
		case: 'a type import beside interface and type declarations',
		path: 'src/Shape.ts',
		content: "import type { Base } from './Base';\n\nexport interface Shape extends Base {\n\tid: number;\n}\n\nexport type Kind = 'a' | 'b';\n",
	},
	{ case: 'an import re-exported by name', path: 'src/reexport.ts', content: "import { add } from './add';\n\nexport { add };\n" },
	{ case: 'an empty file', path: 'src/empty.ts', content: '' },
	// a .tsx path parses with JSX enabled, and an inert type-only .tsx stays inert
	{
		case: 'a type-only .tsx',
		path: 'src/Props.tsx',
		content: "import type { ReactNode } from 'react';\n\nexport interface Props {\n\tchildren: ReactNode;\n}\n",
	},
])('isInertSourceFile: $case has no executable statement, so it is inert', ({ path, content }) => {
	const { compiler } = setup();

	const inert = isInertSourceFile({ path, content, compiler });

	expect(inert).toBe(true);
});

test.each([
	{ case: 'a constant with a fallback expression', path: 'src/config.ts', content: "export const url = process.env.API_URL ?? 'http://localhost';\n" },
	{ case: 'a function', path: 'src/add.ts', content: 'export const add = (a: number, b: number) => a + b;\n' },
	{ case: 'a class', path: 'src/Thing.ts', content: 'export class Thing {\n\tvalue = 1;\n}\n' },
	{ case: 'an enum', path: 'src/Status.ts', content: 'export enum Status {\n\tOpen,\n\tClosed,\n}\n' },
	{ case: 'an export default', path: 'src/main.ts', content: 'export default 42;\n' },
	{ case: 'a JSX component in a .tsx', path: 'src/App.tsx', content: 'export const App = () => <div>hi</div>;\n' },
])('isInertSourceFile: $case is an executable statement, so the file is not inert', ({ path, content }) => {
	const { compiler } = setup();

	const inert = isInertSourceFile({ path, content, compiler });

	expect(inert).toBe(false);
});
