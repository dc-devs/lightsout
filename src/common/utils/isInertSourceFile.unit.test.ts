import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isInertSourceFile } from '@/common/utils/isInertSourceFile';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { linkTypescript } from '@tests/helpers/linkTypescript';

const setup = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-inert-'));

	linkTypescript({ dir });

	const compiler = resolveConsumerTypescript({ cwd: dir });

	if (compiler === undefined) {
		throw new Error('the linked typescript must resolve');
	}

	return { compiler };
};

test('isInertSourceFile: files whose every statement is an import, re-export, or type declaration are inert', () => {
	const { compiler } = setup();

	assert.equal(isInertSourceFile({ path: 'src/barrel.ts', content: "export * from './add';\nexport { Thing } from './Thing';\n", compiler }), true);
	assert.equal(isInertSourceFile({ path: 'src/types.ts', content: "export type { Feature } from './feature';\n", compiler }), true);
	assert.equal(
		isInertSourceFile({ path: 'src/Shape.ts', content: "import type { Base } from './Base';\n\nexport interface Shape extends Base {\n\tid: number;\n}\n\nexport type Kind = 'a' | 'b';\n", compiler }),
		true,
	);
	assert.equal(isInertSourceFile({ path: 'src/reexport.ts', content: "import { add } from './add';\n\nexport { add };\n", compiler }), true);
	assert.equal(isInertSourceFile({ path: 'src/empty.ts', content: '', compiler }), true);
});

test('isInertSourceFile: any executable statement — value, function, class, enum, default — makes the file non-inert', () => {
	const { compiler } = setup();

	assert.equal(isInertSourceFile({ path: 'src/config.ts', content: "export const url = process.env.API_URL ?? 'http://localhost';\n", compiler }), false);
	assert.equal(isInertSourceFile({ path: 'src/add.ts', content: 'export const add = (a: number, b: number) => a + b;\n', compiler }), false);
	assert.equal(isInertSourceFile({ path: 'src/Thing.ts', content: 'export class Thing {\n\tvalue = 1;\n}\n', compiler }), false);
	assert.equal(isInertSourceFile({ path: 'src/Status.ts', content: 'export enum Status {\n\tOpen,\n\tClosed,\n}\n', compiler }), false);
	assert.equal(isInertSourceFile({ path: 'src/main.ts', content: 'export default 42;\n', compiler }), false);
});

test('isInertSourceFile: a .tsx path parses with JSX enabled — an inert type-only .tsx stays inert, a component does not', () => {
	const { compiler } = setup();

	assert.equal(isInertSourceFile({ path: 'src/Props.tsx', content: "import type { ReactNode } from 'react';\n\nexport interface Props {\n\tchildren: ReactNode;\n}\n", compiler }), true);
	assert.equal(isInertSourceFile({ path: 'src/App.tsx', content: 'export const App = () => <div>hi</div>;\n', compiler }), false);
});
