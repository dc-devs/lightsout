import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { selectMissingTests } from './selectMissingTests';
import { resolveConsumerTypescript } from '../common/utils/resolveConsumerTypescript';
import { linkTypescript } from '../../tests/helpers/linkTypescript';

const setup = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-misstest-'));

	mkdirSync(join(dir, 'src'), { recursive: true });
	linkTypescript({ dir });

	return { dir, compiler: resolveConsumerTypescript({ cwd: dir }) };
};

test('a new runtime source file with no sibling routes to missingTests', async () => {
	const { dir, compiler } = setup();

	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 1;\n');

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/widget.ts'], newFiles: ['src/widget.ts'], compiler });

	assert.deepEqual(result.missingTests, ['src/widget.ts']);
	assert.deepEqual(result.untestedChanges, []);
});

test('the same file passed as modified (not new) routes to untestedChanges instead', async () => {
	const { dir, compiler } = setup();

	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 1;\n');

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/widget.ts'], newFiles: [], compiler });

	assert.deepEqual(result.missingTests, []);
	assert.deepEqual(result.untestedChanges, ['src/widget.ts']);
});

test('a co-located test sibling exempts the file entirely', async () => {
	const { dir, compiler } = setup();

	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 1;\n');
	writeFileSync(join(dir, 'src/widget.unit.test.ts'), 'export const t = 1;\n');

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/widget.ts'], newFiles: ['src/widget.ts'], compiler });

	assert.deepEqual(result.missingTests, []);
	assert.deepEqual(result.untestedChanges, []);
});

test('an inert barrel/type-only file is skipped', async () => {
	const { dir, compiler } = setup();

	writeFileSync(join(dir, 'src/index.ts'), "export { widget } from './widget';\n");

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/index.ts'], newFiles: ['src/index.ts'], compiler });

	assert.deepEqual(result.missingTests, []);
	assert.deepEqual(result.untestedChanges, []);
});

test('a deleted file (absent on disk) is skipped', async () => {
	const { dir, compiler } = setup();

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/gone.ts'], newFiles: ['src/gone.ts'], compiler });

	assert.deepEqual(result.missingTests, []);
	assert.deepEqual(result.untestedChanges, []);
});

test('a non-JS/TS file is skipped', async () => {
	const { dir, compiler } = setup();

	writeFileSync(join(dir, 'src/data.json'), '{}\n');

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/data.json'], newFiles: ['src/data.json'], compiler });

	assert.deepEqual(result.missingTests, []);
	assert.deepEqual(result.untestedChanges, []);
});

test('a test file passed as a change is itself skipped', async () => {
	const { dir, compiler } = setup();

	writeFileSync(join(dir, 'src/widget.unit.test.ts'), 'export const t = 1;\n');

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/widget.unit.test.ts'], newFiles: ['src/widget.unit.test.ts'], compiler });

	assert.deepEqual(result.missingTests, []);
	assert.deepEqual(result.untestedChanges, []);
});

test('no resolvable compiler skips the whole check with a note', async () => {
	const { dir } = setup();

	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 1;\n');

	const result = await selectMissingTests({ cwd: dir, changedFiles: ['src/widget.ts'], newFiles: ['src/widget.ts'], compiler: undefined });

	assert.deepEqual(result.missingTests, []);
	assert.deepEqual(result.untestedChanges, []);
	assert.match(result.notes[0] ?? '', /missing-tests check skipped/);
});
