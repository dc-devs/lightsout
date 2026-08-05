import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ScanDetector, ScanSeverity } from '@/contracts';
import type { ScanFinding } from '@/contracts';
import { printFinding } from '@/cli/common/render/printFinding';

// The finding's whole output IS its two console.log lines, so capturing them
// is the arrangement. isTTY is pinned off so the ANSI paint helpers stay
// no-ops and the assertions read the plain text a piped consumer sees.
const setupFinding = ({
	t,
	files,
	severity = ScanSeverity.Finding,
}: {
	t: TestContext;
	files: ScanFinding['files'];
	severity?: ScanSeverity;
}) => {
	const logged: string[] = [];
	const wasTty = process.stdout.isTTY;

	process.stdout.isTTY = false;
	t.after(() => {
		process.stdout.isTTY = wasTty;
	});

	t.mock.method(console, 'log', (...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	const entry: ScanFinding = {
		detector: ScanDetector.Clone,
		severity,
		cluster: 'clone:runGates',
		files,
		detail: 'two spans are token-identical',
	};

	return { entry, logged };
};

// The detector occupies a 20-wide column after the one-character icon and its
// gutter: 'clone' is 5 of those 20, and the span line below indents past the
// whole column (2 + 20). Spelled as repeats so the counts stay readable.
const restOfColumn = ' '.repeat(15);
const spanIndent = ' '.repeat(22);

test('printFinding: a finding renders the warning icon, a padded detector column, the detail, and its span on a second line', (t) => {
	const { entry, logged } = setupFinding({ t, files: [{ path: 'src/a.ts', startLine: 10, endLine: 20 }] });

	printFinding({ entry });

	assert.deepEqual(logged, [`⚠ clone${restOfColumn}two spans are token-identical`, `${spanIndent}src/a.ts:10-20`]);
});

test('printFinding: an advisory swaps the warning icon for the info icon and changes nothing else', (t) => {
	const { entry, logged } = setupFinding({ t, files: [{ path: 'src/a.ts', startLine: 10, endLine: 20 }], severity: ScanSeverity.Advisory });

	printFinding({ entry });

	assert.deepEqual(logged, [`ℹ clone${restOfColumn}two spans are token-identical`, `${spanIndent}src/a.ts:10-20`]);
});

test('printFinding: each file contributes a span — bare path, single line, or a range only when the end line differs', (t) => {
	const { entry, logged } = setupFinding({
		t,
		files: [
			{ path: 'src/whole.ts' },
			{ path: 'src/start.ts', startLine: 5 },
			{ path: 'src/same.ts', startLine: 7, endLine: 7 },
			{ path: 'src/range.ts', startLine: 1, endLine: 9 },
		],
	});

	printFinding({ entry });

	assert.equal(logged[1], `${spanIndent}src/whole.ts, src/start.ts:5, src/same.ts:7, src/range.ts:1-9`);
});
