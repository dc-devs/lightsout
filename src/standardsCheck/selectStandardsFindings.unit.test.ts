import { expect, test } from '@jest/globals';
import type { StandardsFinding } from '@/contracts';
import { selectStandardsFindings } from '@/standardsCheck';

const finding = (overrides: Partial<StandardsFinding>): StandardsFinding => ({
	rule: 'structure',
	severity: 'finding',
	siteKey: 'multi-export:src/a.ts',
	files: [{ path: 'src/a.ts' }],
	detail: 'x',
	...overrides,
});

test('selectStandardsFindings keeps finding-severity items touching changed files; gating is the stable-key subset', () => {
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

	const { workList, advisories, gating } = selectStandardsFindings({ findings, changedFiles: ['src/changed.ts'] });

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

test('selectStandardsFindings drops size advisories in files the run never touched', () => {
	const findings: StandardsFinding[] = [
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:function:src/untouched.ts:big', files: [{ path: 'src/untouched.ts', startLine: 5, endLine: 99 }] }),
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:function:src/changed.ts:big', files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }] }),
	];

	const { advisories } = selectStandardsFindings({ findings, changedFiles: ['src/changed.ts'] });

	// pre-existing debt outside the run stays out of the judgment list
	expect(advisories.map((entry) => entry.siteKey)).toStrictEqual(['size:function:src/changed.ts:big']);
});

test('selectStandardsFindings never gates on an advisory whose site key carries a gating prefix', () => {
	const findings: StandardsFinding[] = [
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
	];

	const selected = selectStandardsFindings({ findings, changedFiles: ['src/changed.ts'] });

	// gating is a workList subset, so severity decides before the site-key prefix
	// does
	expect({ workList: selected.workList.map((entry) => entry.siteKey), advisories: selected.advisories.map((entry) => entry.siteKey), gating: selected.gating.map((entry) => entry.siteKey) }).toStrictEqual({ workList: [], advisories: ['size:file:src/changed.ts'], gating: [] });
});

test('selectStandardsFindings gates on the file-level size key but not the per-function one', () => {
	const findings: StandardsFinding[] = [
		finding({ rule: 'size', siteKey: 'size:file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ rule: 'size', siteKey: 'size:function:src/changed.ts:big', files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }] }),
	];

	const selected = selectStandardsFindings({ findings, changedFiles: ['src/changed.ts'] });

	// the per-function key embeds a name, so it is work but never a block —
	// the gate keys on `size:file:`, not on `size:`
	expect({ workList: selected.workList.map((entry) => entry.siteKey), gating: selected.gating.map((entry) => entry.siteKey) }).toStrictEqual({
		workList: ['size:file:src/changed.ts', 'size:function:src/changed.ts:big'],
		gating: ['size:file:src/changed.ts'],
	});
});

test('selectStandardsFindings forwards each finding whole, not a projection of it', () => {
	const gated = finding({
		rule: 'module-boundary',
		siteKey: 'boundary:src/changed.ts',
		files: [{ path: 'src/changed.ts', startLine: 3, endLine: 9 }],
		detail: 'src/changed.ts deep-imports src/other/common/x.ts',
		guidance: 'Import through the module barrel.',
	});

	const selected = selectStandardsFindings({ findings: [gated], changedFiles: ['src/changed.ts'] });

	// the refactor agent reads detail, guidance and the line spans, so every list
	// carries the finding itself
	expect(selected).toStrictEqual({ workList: [gated], advisories: [], gating: [gated] });
});

test('selectStandardsFindings matches against every changed file, not only the first', () => {
	const findings: StandardsFinding[] = [
		finding({ siteKey: 'multi-export:src/first.ts', files: [{ path: 'src/first.ts' }] }),
		finding({ rule: 'barrel-hygiene', siteKey: 'barrel-star:src/second/index.ts', files: [{ path: 'src/second/index.ts' }] }),
		finding({ siteKey: 'multi-export:src/third.ts', files: [{ path: 'src/third.ts' }] }),
	];

	const selected = selectStandardsFindings({ findings, changedFiles: ['src/first.ts', 'src/second/index.ts'] });

	// a later changed file selects just as a first one does, and barrel-star is
	// work-list only — it never joins the gate
	expect({ workList: selected.workList.map((entry) => entry.siteKey), gating: selected.gating.map((entry) => entry.siteKey) }).toStrictEqual({
		workList: ['multi-export:src/first.ts', 'barrel-star:src/second/index.ts'],
		gating: ['multi-export:src/first.ts'],
	});
});

test('selectStandardsFindings selects nothing when the run changed no files', () => {
	const findings: StandardsFinding[] = [
		finding({ siteKey: 'multi-export:src/a.ts', files: [{ path: 'src/a.ts' }] }),
		finding({ rule: 'size', severity: 'advisory', siteKey: 'size:function:src/a.ts:big', files: [{ path: 'src/a.ts', startLine: 5, endLine: 99 }] }),
	];

	const selected = selectStandardsFindings({ findings, changedFiles: [] });

	// an empty changed-file set touches nothing
	expect(selected).toStrictEqual({ workList: [], advisories: [], gating: [] });
});
