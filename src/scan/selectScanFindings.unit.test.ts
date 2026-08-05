import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanFinding } from '@/contracts';
import { selectScanFindings } from '@/scan';

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

test('selectScanFindings drops size advisories in files the run never touched', () => {
	const findings: ScanFinding[] = [
		finding({ detector: 'size', severity: 'advisory', cluster: 'size:function:src/untouched.ts:big', files: [{ path: 'src/untouched.ts', startLine: 5, endLine: 99 }] }),
		finding({ detector: 'size', severity: 'advisory', cluster: 'size:function:src/changed.ts:big', files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }] }),
	];

	const { advisories } = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	assert.deepEqual(
		advisories.map((entry) => entry.cluster),
		['size:function:src/changed.ts:big'],
		'pre-existing debt outside the run stays out of the judgment list',
	);
});

test('selectScanFindings never gates on an advisory whose cluster carries a gating prefix', () => {
	const findings: ScanFinding[] = [
		finding({ detector: 'size', severity: 'advisory', cluster: 'size:file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
	];

	const selected = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	assert.deepEqual(
		{ workList: selected.workList.map((entry) => entry.cluster), advisories: selected.advisories.map((entry) => entry.cluster), gating: selected.gating.map((entry) => entry.cluster) },
		{ workList: [], advisories: ['size:file:src/changed.ts'], gating: [] },
		'gating is a workList subset, so severity decides before the cluster prefix does',
	);
});

test('selectScanFindings selects nothing when the run changed no files', () => {
	const findings: ScanFinding[] = [
		finding({ cluster: 'multi-export:src/a.ts', files: [{ path: 'src/a.ts' }] }),
		finding({ detector: 'size', severity: 'advisory', cluster: 'size:function:src/a.ts:big', files: [{ path: 'src/a.ts', startLine: 5, endLine: 99 }] }),
	];

	const selected = selectScanFindings({ findings, changedFiles: [] });

	assert.deepEqual(selected, { workList: [], advisories: [], gating: [] }, 'an empty changed-file set touches nothing');
});
