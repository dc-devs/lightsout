import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readCommittedTestSource } from '#src/pipeline/steps/ledger/readCommittedTestSource.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const movedFrom = 'src/widget.unit.test.js';
const movedTo = 'src/widget/widget.unit.test.js';
const untouched = 'src/other.unit.test.js';

/**
 * A repo whose HEAD carries the move's source and an unrelated test file, and
 * carries nothing at the move's destination — the state the ledger step reads
 * in: the plan's move has not happened yet, so the cases the destination will
 * inherit are still committed at the source.
 */
const setupCommittedTests = () => {
	const cwd = setupConsumerRepo();

	for (const [path, source] of [
		[movedFrom, "test('widget: renders nothing when disabled', () => {});\n"],
		[untouched, "test('other: totals an empty basket as zero', () => {});\n"],
	]) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), source);
	}

	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm tests', { cwd });

	return { cwd, movePaths: [{ from: movedFrom, to: movedTo }] };
};

describe('readCommittedTestSource', () => {
	test('readCommittedTestSource: a move destination reads HEAD at its source, and any other file reads HEAD at itself', async () => {
		const { cwd, movePaths } = setupCommittedTests();

		const destination = await readCommittedTestSource({ cwd, testFile: movedTo, movePaths });
		const other = await readCommittedTestSource({ cwd, testFile: untouched, movePaths });

		// the destination does not exist at HEAD, so reading it directly would
		// answer "nothing committed" and let a test written for older behaviour be
		// named as a new criterion's verifier simply by moving its file. The
		// source is where those cases are, so the source is what is read.
		expect(destination).toBe("test('widget: renders nothing when disabled', () => {});\n");
		// a file the plan does not move is read at its own path
		expect(other).toBe("test('other: totals an empty basket as zero', () => {});\n");
	});
});
