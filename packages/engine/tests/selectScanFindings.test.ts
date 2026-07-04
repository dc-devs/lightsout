import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanFinding } from '@lightsout/contracts';
import { selectScanFindings } from '../src/index';

const finding = (overrides: Partial<ScanFinding>): ScanFinding => ({
	detector: 'structure',
	severity: 'finding',
	cluster: 'multi-export:src/a.ts',
	files: [{ path: 'src/a.ts' }],
	detail: 'x',
	...overrides,
});

test('selectScanFindings keeps finding-severity items touching changed files; gating is the stable-key subset', () => {
	const findings: ScanFinding[] = [
		finding({ cluster: 'multi-export:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ detector: 'ast-duplicate', cluster: 'ast:abc123def456', files: [{ path: 'src/changed.ts' }, { path: 'src/legacy.ts' }] }),
		finding({ detector: 'clone', cluster: 'clone:src/changed.ts:10', files: [{ path: 'src/changed.ts', startLine: 10, endLine: 40 }] }),
		finding({ detector: 'size', cluster: 'size:file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ detector: 'size', severity: 'advisory', cluster: 'size:function:src/changed.ts:big', files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }] }),
		finding({ severity: 'advisory', cluster: 'filename-mismatch:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ cluster: 'multi-export:src/untouched.ts', files: [{ path: 'src/untouched.ts' }] }),
	];

	const { workList, gating } = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	assert.deepEqual(
		workList.map((entry) => entry.cluster),
		['multi-export:src/changed.ts', 'ast:abc123def456', 'clone:src/changed.ts:10', 'size:file:src/changed.ts'],
		'advisories and untouched-file findings excluded; the changed↔legacy dup included',
	);
	assert.deepEqual(
		gating.map((entry) => entry.cluster),
		['multi-export:src/changed.ts', 'ast:abc123def456', 'size:file:src/changed.ts'],
		'path-keyed file size gates; line-keyed clone and per-function size inform but never gate',
	);
});
