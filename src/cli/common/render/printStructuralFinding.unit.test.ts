import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { StructuralCheck } from '@/contracts';
import type { StructuralFinding } from '@/contracts';
import { printStructuralFinding } from '@/cli/common/render/printStructuralFinding';

// The finding's whole output IS its two console.log lines, so capturing them is
// the arrangement. isTTY decides whether the paint helpers emit ANSI, so it is
// pinned per test: off reads the plain text a piped consumer sees, on pins
// which segment wears which colour.
const setupStructuralFinding = ({ t, isTty = false, finding = {} }: { t: TestContext; isTty?: boolean; finding?: Partial<StructuralFinding> }) => {
	const logged: string[] = [];
	const wasTty = process.stdout.isTTY;

	process.stdout.isTTY = isTty;
	t.after(() => {
		process.stdout.isTTY = wasTty;
	});

	t.mock.method(console, 'log', (...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	const entry: StructuralFinding = {
		check: StructuralCheck.PathExists,
		issue: 'the file does not exist',
		location: 'Files to Modify → src/missing.ts',
		fix: 'correct the path or list it under Files to Create',
		...finding,
	};

	return { finding: entry, logged };
};

test('printStructuralFinding: renders the icon, check, location and issue on the first line and the fix on the second', (t) => {
	const { finding, logged } = setupStructuralFinding({ t });

	printStructuralFinding({ finding });

	assert.deepEqual(logged, ['⚠ [path-exists] Files to Modify → src/missing.ts — the file does not exist', '   fix: correct the path or list it under Files to Create']);
});

test('printStructuralFinding: the check name is printed verbatim, whichever check produced the finding', (t) => {
	const { finding, logged } = setupStructuralFinding({
		t,
		finding: { check: StructuralCheck.NoPlaceholders, issue: 'TBD left in the plan', location: 'Decision Log row 3', fix: 'settle the decision or delete the row' },
	});

	printStructuralFinding({ finding });

	assert.deepEqual(logged, ['⚠ [no-placeholders] Decision Log row 3 — TBD left in the plan', '   fix: settle the decision or delete the row']);
});

test('printStructuralFinding: on a TTY only the icon is yellow and only the fix line is dim', (t) => {
	const { finding, logged } = setupStructuralFinding({ t, isTty: true });

	printStructuralFinding({ finding });

	assert.deepEqual(logged, [
		'\u001b[33m⚠\u001b[0m [path-exists] Files to Modify → src/missing.ts — the file does not exist',
		'\u001b[2m   fix: correct the path or list it under Files to Create\u001b[0m',
	]);
});
