import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanFinding } from '@lightsout/contracts';
import { selectScanFindings } from './index';

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
		finding({ detector: 'module-boundary', cluster: 'boundary:src/changed.ts', files: [{ path: 'src/changed.ts' }, { path: 'src/other.ts' }] }),
		finding({ detector: 'placement', cluster: 'placement:src/other/common/x.ts', files: [{ path: 'src/other/common/x.ts' }, { path: 'src/changed.ts' }] }),
	];

	const { workList, advisories, gating } = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	assert.deepEqual(
		workList.map((entry) => entry.cluster),
		['multi-export:src/changed.ts', 'ast:abc123def456', 'clone:src/changed.ts:10', 'size:file:src/changed.ts', 'boundary:src/changed.ts', 'placement:src/other/common/x.ts'],
		'advisories and untouched-file findings excluded; the changed↔legacy dup and both architecture findings included',
	);
	assert.deepEqual(
		gating.map((entry) => entry.cluster),
		['multi-export:src/changed.ts', 'ast:abc123def456', 'size:file:src/changed.ts', 'boundary:src/changed.ts'],
		'path-keyed file size and module boundaries gate; line-keyed clone, per-function size and placement inform but never gate',
	);
	assert.deepEqual(
		advisories.map((entry) => entry.cluster),
		['size:function:src/changed.ts:big'],
		'size advisories flow to the agent as judgment items; non-size advisories do not',
	);
});
