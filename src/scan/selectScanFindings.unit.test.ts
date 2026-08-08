import { expect, test } from '@jest/globals';
import type { StandardsFinding } from '@/contracts';
import { selectScanFindings } from '@/scan';

const finding = (overrides: Partial<StandardsFinding>): StandardsFinding => ({
	rule: 'structure',
	severity: 'finding',
	siteKey: 'multi-export:src/a.ts',
	files: [{ path: 'src/a.ts' }],
	detail: 'x',
	...overrides,
});

test('selectScanFindings keeps finding-severity items touching changed files; gating is the stable-key subset', () => {
	const findings: StandardsFinding[] = [
		finding({ siteKey: 'multi-export:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ rule: 'ast-duplicate', siteKey: 'ast:abc123def456', files: [{ path: 'src/changed.ts' }, { path: 'src/legacy.ts' }] }),
		finding({ rule: 'clone', siteKey: 'clone:src/changed.ts:10', files: [{ path: 'src/changed.ts', startLine: 10, endLine: 40 }] }),
		finding({ rule: 'size', siteKey: 'size:file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:function:src/changed.ts:big', files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }] }),
		finding({ severity: 'advisory', siteKey: 'filename-mismatch:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ siteKey: 'multi-export:src/untouched.ts', files: [{ path: 'src/untouched.ts' }] }),
		finding({ rule: 'module-boundary', siteKey: 'boundary:src/changed.ts', files: [{ path: 'src/changed.ts' }, { path: 'src/other.ts' }] }),
		finding({ rule: 'placement', siteKey: 'placement:src/other/common/x.ts', files: [{ path: 'src/other/common/x.ts' }, { path: 'src/changed.ts' }] }),
	];

	const { workList, advisories, gating } = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	// advisories and untouched-file findings excluded; the changed↔legacy dup and
	// both architecture findings included
	expect(workList.map((entry) => entry.siteKey)).toStrictEqual(['multi-export:src/changed.ts', 'ast:abc123def456', 'clone:src/changed.ts:10', 'size:file:src/changed.ts', 'boundary:src/changed.ts', 'placement:src/other/common/x.ts']);
	// path-keyed file size and module boundaries gate; line-keyed clone,
	// per-function size and placement inform but never gate
	expect(gating.map((entry) => entry.siteKey)).toStrictEqual(['multi-export:src/changed.ts', 'ast:abc123def456', 'size:file:src/changed.ts', 'boundary:src/changed.ts']);
	// size advisories flow to the agent as judgment items; non-size advisories do
	// not
	expect(advisories.map((entry) => entry.siteKey)).toStrictEqual(['size:function:src/changed.ts:big']);
});

test('selectScanFindings drops size advisories in files the run never touched', () => {
	const findings: StandardsFinding[] = [
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:function:src/untouched.ts:big', files: [{ path: 'src/untouched.ts', startLine: 5, endLine: 99 }] }),
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:function:src/changed.ts:big', files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }] }),
	];

	const { advisories } = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	// pre-existing debt outside the run stays out of the judgment list
	expect(advisories.map((entry) => entry.siteKey)).toStrictEqual(['size:function:src/changed.ts:big']);
});

test('selectScanFindings never gates on an advisory whose site key carries a gating prefix', () => {
	const findings: StandardsFinding[] = [
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
	];

	const selected = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	// gating is a workList subset, so severity decides before the site-key prefix
	// does
	expect({ workList: selected.workList.map((entry) => entry.siteKey), advisories: selected.advisories.map((entry) => entry.siteKey), gating: selected.gating.map((entry) => entry.siteKey) }).toStrictEqual({ workList: [], advisories: ['size:file:src/changed.ts'], gating: [] });
});

test('selectScanFindings gates on the file-level size key but not the per-function one', () => {
	const findings: StandardsFinding[] = [
		finding({ rule: 'size', siteKey: 'size:file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ rule: 'size', siteKey: 'size:function:src/changed.ts:big', files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }] }),
	];

	const selected = selectScanFindings({ findings, changedFiles: ['src/changed.ts'] });

	// the per-function key embeds a name, so it is work but never a block —
	// the gate keys on `size:file:`, not on `size:`
	expect({ workList: selected.workList.map((entry) => entry.siteKey), gating: selected.gating.map((entry) => entry.siteKey) }).toStrictEqual({
		workList: ['size:file:src/changed.ts', 'size:function:src/changed.ts:big'],
		gating: ['size:file:src/changed.ts'],
	});
});

test('selectScanFindings selects nothing when the run changed no files', () => {
	const findings: StandardsFinding[] = [
		finding({ siteKey: 'multi-export:src/a.ts', files: [{ path: 'src/a.ts' }] }),
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:function:src/a.ts:big', files: [{ path: 'src/a.ts', startLine: 5, endLine: 99 }] }),
	];

	const selected = selectScanFindings({ findings, changedFiles: [] });

	// an empty changed-file set touches nothing
	expect(selected).toStrictEqual({ workList: [], advisories: [], gating: [] });
});
