import { expect, test, jest } from '@jest/globals';
import { RunStatus, type RunManifest } from '@/contracts';
import type { RefactorResult } from '@/refactor';
import { printRefactorResult } from '@/cli/common/render/printRefactorResult';

// isTTY is pinned off so the ANSI paint helpers stay no-ops and the assertions
// read the plain text a piped consumer sees.
const setupResult = ({ manifest = {}, ...rest }: Omit<Partial<RefactorResult>, 'manifest'> & { manifest?: Partial<RunManifest> } = {}) => {
	const logged: string[] = [];
	const errors: string[] = [];

	process.stdout.isTTY = false;

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		errors.push(String(args[0]));
	});

	const result: RefactorResult = {
		ok: true,
		declined: [],
		before: {},
		after: {},
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
			...manifest,
		},
	};

	return { result, logged, errors, output: () => logged.join('\n') };
};

test('printRefactorResult: a resolved batch reports as resolved with its changed-file count', () => {
	const { result, output } = setupResult({
		before: { clone: 3 },
		after: { clone: 0 },
		manifest: { steps: [{ id: 'batch-1', status: RunStatus.Passed, attempts: 1, changedFiles: ['src/a.ts', 'src/b.ts'] }], changedFiles: ['src/a.ts', 'src/b.ts'] },
	});

	printRefactorResult({ result });

	expect(output()).toContain('✓ batch-1');
	expect(output()).toContain('resolved');
	expect(output()).toContain('· 2 file(s)');
	// the burn-down is the point of the run
	expect(output()).toMatch(/clone\s+3 → 0/);
	expect(output()).toContain('2 file(s) changed in the working tree');
	expect(output()).toContain('evidence: .lightsout/runs/run-1234-abcd/');
});

test('printRefactorResult: a decline is a judgment — it rides in the status line and prints the agent rationale', () => {
	const { result, output } = setupResult({
		declined: [{ batchId: 'batch-1', remainingClusters: ['size:file:src/a.ts', 'clone:x'], rationale: ['[scope] the cap is the wrong signal here'] }],
		manifest: { steps: [{ id: 'batch-1', status: RunStatus.Passed, attempts: 1 }] },
	});

	printRefactorResult({ result });

	// a declined batch still PASSED — the icon must not read as failure
	expect(output()).toContain('⤫ batch-1');
	expect(output()).toContain('PASSED · 1 declined');
	expect(output()).toContain('declined (2 cluster(s) persist)');
	expect(output()).toContain('[scope] the cap is the wrong signal here');
});

test('printRefactorResult: a parked run prints no burn-down, because its after merely echoes before', () => {
	const { result, output, errors } = setupResult({
		ok: false,
		error: 'run parked: harness rate limit reached',
		before: { clone: 3 },
		after: { clone: 3 },
		manifest: { status: RunStatus.PausedRateLimit, steps: [{ id: 'batch-1', status: RunStatus.PausedRateLimit, attempts: 1 }] },
	});

	printRefactorResult({ result });

	// printing 3 → 3 would read as "nothing improved" rather than "not measured"
	expect(output()).not.toContain('burn-down (findings before → after)');
	expect(output()).toContain('no burn-down until the run completes');
	expect(output()).toContain('✗ batch-1');
	expect(errors.join('\n')).toContain('run parked: harness rate limit reached');
});

test('printRefactorResult: a run with no batches still reports its status and evidence path', () => {
	const { result, output } = setupResult();

	printRefactorResult({ result });

	expect(output()).toContain('refactor run-1234 — PASSED');
	expect(output()).toContain('evidence: .lightsout/runs/run-1234-abcd/');
	// nothing changed, so no review prompt
	expect(output()).not.toContain('file(s) changed in the working tree');
});
