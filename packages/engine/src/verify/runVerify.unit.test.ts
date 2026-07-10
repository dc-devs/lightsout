import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { VerifyReport } from '@lightsout/contracts';
import { runVerify } from './index';
import { linkTypescript } from '../../tests/helpers/linkTypescript';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

const commit = ({ dir, message }: { dir: string; message: string }) =>
	execSync(`git add -A && git -c user.name=t -c user.email=t@t commit -qm ${message}`, { cwd: dir });

/**
 * A consumer repo with typescript resolvable (so inert classification runs) and
 * node_modules ignored + committed, so an unchanged tree reads as clean.
 */
const setup = ({ scripts, config }: { scripts?: Record<string, string | false>; config?: Record<string, unknown> } = {}) => {
	const dir = setupConsumerRepo({ git: true, scripts, config });

	linkTypescript({ dir });
	writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.lightsout/\n');
	commit({ dir, message: 'ignore' });

	return dir;
};

test('a clean tree verifies clean with the empty-basis note and no gates', async () => {
	const dir = setup();

	const report = await runVerify({ cwd: dir });

	assert.equal(report.verdict, 'clean');
	assert.deepEqual(report.changedFiles, []);
	assert.deepEqual(report.gates, []);
	assert.match(report.notes[0] ?? '', /nothing to verify/);

	const persisted = VerifyReport.parse(JSON.parse(readFileSync(join(dir, '.lightsout', 'verify.json'), 'utf8')));

	assert.deepEqual(persisted, report);
});

test('a modified source file with a co-located test sibling verifies clean', async () => {
	const dir = setup();

	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 1;\n');
	writeFileSync(join(dir, 'src/widget.unit.test.ts'), 'export const t = 1;\n');
	commit({ dir, message: 'widget' });
	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 2;\n');

	const report = await runVerify({ cwd: dir });

	assert.ok(report.changedFiles.includes('src/widget.ts'));
	assert.deepEqual(report.missingTests, []);
	assert.deepEqual(report.untestedChanges, []);
	assert.equal(report.verdict, 'clean');
});

test('a NEW untested source file goes to missingTests and reds the verdict', async () => {
	const dir = setup();

	writeFileSync(join(dir, 'src/gadget.ts'), 'export const gadget = () => 1;\n');

	const report = await runVerify({ cwd: dir });

	assert.ok(report.missingTests.includes('src/gadget.ts'));
	assert.deepEqual(report.untestedChanges, []);
	assert.equal(report.verdict, 'red');
});

test('a MODIFIED untested source file is an advisory that does not red the verdict', async () => {
	const dir = setup();

	writeFileSync(join(dir, 'src/legacy.ts'), 'export const legacy = () => 1;\n');
	commit({ dir, message: 'legacy' });
	writeFileSync(join(dir, 'src/legacy.ts'), 'export const legacy = () => 2;\n');

	const report = await runVerify({ cwd: dir });

	assert.ok(report.untestedChanges.includes('src/legacy.ts'));
	assert.deepEqual(report.missingTests, []);
	assert.equal(report.verdict, 'clean');
});

test('a red check gate surfaces gatesError with an outputTail and reds the verdict', async () => {
	const dir = setup({ scripts: { check: 'node -e "process.exit(1)"' } });

	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 1;\n');
	writeFileSync(join(dir, 'src/widget.unit.test.ts'), 'export const t = 1;\n');
	commit({ dir, message: 'widget' });
	writeFileSync(join(dir, 'src/widget.ts'), 'export const widget = () => 2;\n');

	const report = await runVerify({ cwd: dir });

	assert.notEqual(report.gatesError, undefined);
	assert.ok(
		report.gates.some((gate) => gate.exitCode !== undefined && gate.exitCode !== 0 && gate.outputTail !== undefined),
		'a red gate execution with an outputTail was recorded',
	);
	assert.equal(report.verdict, 'red');
});

test('a changed file under a generated prefix is excluded from the basis', async () => {
	const dir = setup({ config: { generated: ['src/gen/'] } });

	mkdirSync(join(dir, 'src', 'gen'), { recursive: true });
	writeFileSync(join(dir, 'src/gen/output.ts'), 'export const out = 1;\n');

	const report = await runVerify({ cwd: dir });

	assert.ok(!report.changedFiles.includes('src/gen/output.ts'));
	assert.equal(report.verdict, 'clean');
	assert.match(report.notes[0] ?? '', /nothing to verify/);
});

test('a bogus --base ref rejects (the CLI exit-2 path)', async () => {
	const dir = setup();

	await assert.rejects(runVerify({ cwd: dir, base: 'no-such-ref' }));
});
