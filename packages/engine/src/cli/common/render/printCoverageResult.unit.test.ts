import { expect, jest, test } from '@jest/globals';
import { printCoverageResult } from '@/cli/common/render/printCoverageResult';
import { type RunManifest, RunStatus } from '@/contracts';
import type { CoverageResult } from '@/coverage';

// isTTY is pinned off so the ANSI paint helpers stay no-ops and the assertions
// read the plain text a piped consumer sees.
const setupResult = ({ manifest = {}, ...rest }: Omit<Partial<CoverageResult>, 'manifest'> & { manifest?: Partial<RunManifest> } = {}) => {
	const logged: string[] = [];
	const errors: string[] = [];

	process.stdout.isTTY = false;

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		errors.push(String(args[0]));
	});

	const result: CoverageResult = {
		ok: true,
		setAside: [],
		before: [],
		after: [],
		...rest,
		manifest: {
			runId: 'run-1234-abcd',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:03.000Z',
			plan: '',
			harness: 'claude-code',
			status: RunStatus.Passed,
			currentStep: null,
			steps: [],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
			testSubjects: [],
			unreachableChangedFiles: [],
			...manifest,
		},
	};

	return { result, logged, errors, output: () => logged.join('\n') };
};

test('printCoverageResult: a completed run reports each batch and the coverage it moved', () => {
	const { result, output } = setupResult({
		before: [{ scope: 'root', statementsPct: 61, passed: false }],
		after: [{ scope: 'root', statementsPct: 96, passed: true }],
		manifest: {
			steps: [{ id: 'batch-01:root', status: RunStatus.Passed, attempts: 1, changedFiles: ['src/a.unit.test.ts', 'src/b.unit.test.ts'] }],
			changedFiles: ['src/a.unit.test.ts', 'src/b.unit.test.ts'],
		},
	});

	printCoverageResult({ result });

	expect(output()).toContain('✓ batch-01:root');
	expect(output()).toContain('resolved');
	expect(output()).toContain('· 2 file(s)');
	// moving the number is the point of the run
	expect(output()).toMatch(/root\s+61 → 96/);
	expect(output()).toContain('2 file(s) changed in the working tree');
	expect(output()).toContain('evidence: .lightsout/runs/run-1234-abcd/');
});

test('printCoverageResult: a set-aside batch names its files, its reason and what a human owes it', () => {
	const { result, output } = setupResult({
		setAside: [{ batchId: 'batch-02:api', files: ['packages/api/src/hard.ts'], rationale: ['[failed] the module cannot be tested without splitting it'] }],
		manifest: { steps: [{ id: 'batch-02:api', status: RunStatus.Passed, attempts: 1 }] },
	});

	printCoverageResult({ result });

	// a set-aside batch still PASSED — the icon must not read as failure
	expect(output()).toContain('⤫ batch-02:api');
	expect(output()).toContain('PASSED · 1 set aside');
	expect(output()).toContain('declined (1 file(s) set aside)');
	expect(output()).toContain('packages/api/src/hard.ts');
	expect(output()).toContain('[failed] the module cannot be tested without splitting it');
	expect(output()).toContain('these files likely need source changes');
});

test('printCoverageResult: a parked run prints no table, because its after merely echoes before', () => {
	const { result, output, errors } = setupResult({
		ok: false,
		error: 'run parked: harness rate limit reached',
		before: [{ scope: 'root', statementsPct: 61, passed: false }],
		after: [{ scope: 'root', statementsPct: 61, passed: false }],
		manifest: { status: RunStatus.PausedRateLimit, steps: [{ id: 'batch-01:root', status: RunStatus.PausedRateLimit, attempts: 1 }] },
	});

	printCoverageResult({ result });

	// printing 61 → 61 would read as "nothing improved" rather than "not measured"
	expect(output()).not.toContain('coverage (statements before → after)');
	expect(output()).toContain('no final measure until the run completes');
	// the batch that stopped the run says what it stopped as — neither resolved nor declined
	expect(output()).toContain('✗ batch-01:root');
	expect(output()).toMatch(/batch-01:root\s+paused-rate-limit/);
	expect(errors.join('\n')).toContain('run parked: harness rate limit reached');
});

test('printCoverageResult: the table lists every scope either measurement saw, alphabetically', () => {
	const { result, output } = setupResult({
		before: [
			{ scope: 'cli', statementsPct: 40, passed: false },
			{ scope: 'web', statementsPct: 80, passed: false },
		],
		after: [
			{ scope: 'api', statementsPct: 95, passed: true },
			{ scope: 'web', statementsPct: 96, passed: true },
		],
	});

	printCoverageResult({ result });

	// a scope only the final measure reached still owes a row, read as zero before
	expect(output()).toMatch(/api\s+0 → 95/);
	// and one only the first measure saw owes a row too, read as zero after
	expect(output()).toMatch(/cli\s+40 → 0/);
	expect(output()).toMatch(/web\s+80 → 96/);
	expect(output().indexOf('api')).toBeLessThan(output().indexOf('web'));
});

test('printCoverageResult: a stopped run with no error message writes nothing to stderr', () => {
	const { result, output, errors } = setupResult({ ok: false, manifest: { status: RunStatus.Escalated, steps: [] } });

	printCoverageResult({ result });

	// `error` is optional: an empty stderr line would read as an unnamed failure
	expect(errors).toStrictEqual([]);
	expect(output()).toContain('no final measure until the run completes');
});

test('printCoverageResult: a run that had nothing to do still reports its status and evidence path', () => {
	const { result, output } = setupResult();

	printCoverageResult({ result });

	expect(output()).toContain('test-coverage-to-threshold run-1234 — PASSED');
	expect(output()).toContain('evidence: .lightsout/runs/run-1234-abcd/');
	// nothing changed, so no review prompt
	expect(output()).not.toContain('file(s) changed in the working tree');
});
