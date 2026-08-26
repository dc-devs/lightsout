import { expect, test } from '@jest/globals';
import type { StandardsFinding } from '#src/contracts/index.ts';
import { selectStandardsFindings } from '#src/standardsCheck/index.ts';

const finding = (overrides: Partial<StandardsFinding>): StandardsFinding => ({
	rule: 'multi-export',
	severity: 'blocking',
	siteKey: 'multi-export:src/a.ts',
	files: [{ path: 'src/a.ts' }],
	detail: 'x',
	...overrides,
});

test('selectStandardsFindings keeps every finding-severity item touching a changed file', () => {
	const findings: StandardsFinding[] = [
		finding({ siteKey: 'multi-export:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({
			rule: 'duplicate-function-body',
			siteKey: 'duplicate-function-body:src/changed.ts|src/legacy.ts',
			files: [{ path: 'src/changed.ts' }, { path: 'src/legacy.ts' }],
		}),
		finding({ rule: 'size-file', siteKey: 'size-file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({
			rule: 'size-function',
			severity: 'advisory',
			siteKey: 'size-function:src/changed.ts',
			files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }],
		}),
		finding({ rule: 'filename-mismatch', severity: 'advisory', siteKey: 'filename-mismatch:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
		finding({ siteKey: 'multi-export:src/untouched.ts', files: [{ path: 'src/untouched.ts' }] }),
		finding({ rule: 'module-boundary', siteKey: 'module-boundary:src/changed.ts|src/other.ts', files: [{ path: 'src/changed.ts' }, { path: 'src/other.ts' }] }),
		finding({
			rule: 'placement',
			siteKey: 'placement:src/changed.ts|src/other/common/x.ts',
			files: [{ path: 'src/other/common/x.ts' }, { path: 'src/changed.ts' }],
		}),
	];

	const { workList, advisories } = selectStandardsFindings({ findings, changedFiles: ['src/changed.ts'] });

	// severity is the only lever: every finding touching a changed file is work,
	// including placement and the architecture rules the old allow-list excluded
	expect(workList.map((entry) => entry.siteKey)).toStrictEqual([
		'multi-export:src/changed.ts',
		'duplicate-function-body:src/changed.ts|src/legacy.ts',
		'size-file:src/changed.ts',
		'module-boundary:src/changed.ts|src/other.ts',
		'placement:src/changed.ts|src/other/common/x.ts',
	]);
	// every advisory reaches the agent, not only the size ones — each carries its
	// own guidance, and one it never sees is one it can never judge
	expect(advisories.map((entry) => entry.siteKey)).toStrictEqual(['size-function:src/changed.ts', 'filename-mismatch:src/changed.ts']);
});

test('selectStandardsFindings drops advisories in files the run never touched', () => {
	const findings: StandardsFinding[] = [
		finding({
			rule: 'size-function',
			severity: 'advisory',
			siteKey: 'size-function:src/untouched.ts',
			files: [{ path: 'src/untouched.ts', startLine: 5, endLine: 99 }],
		}),
		finding({
			rule: 'size-function',
			severity: 'advisory',
			siteKey: 'size-function:src/changed.ts',
			files: [{ path: 'src/changed.ts', startLine: 5, endLine: 99 }],
		}),
	];

	const { advisories } = selectStandardsFindings({ findings, changedFiles: ['src/changed.ts'] });

	// pre-existing debt outside the run stays out of the judgment list
	expect(advisories.map((entry) => entry.siteKey)).toStrictEqual(['size-function:src/changed.ts']);
});

test('an advisory never joins the work-list, however blockable its rule looks', () => {
	const findings: StandardsFinding[] = [
		finding({ rule: 'size-file', severity: 'advisory', siteKey: 'size-file:src/changed.ts', files: [{ path: 'src/changed.ts' }] }),
	];

	const selected = selectStandardsFindings({ findings, changedFiles: ['src/changed.ts'] });

	// a repo that dropped size-file to advisory has stopped it blocking — that is
	// the whole mechanism, and no rule identity can override it
	expect({ workList: selected.workList.map((entry) => entry.siteKey), advisories: selected.advisories.map((entry) => entry.siteKey) }).toStrictEqual({
		workList: [],
		advisories: ['size-file:src/changed.ts'],
	});
});

test('selectStandardsFindings forwards each finding whole, not a projection of it', () => {
	const gated = finding({
		rule: 'module-boundary',
		siteKey: 'module-boundary:src/changed.ts|src/other/common/x.ts',
		files: [{ path: 'src/changed.ts', startLine: 3, endLine: 9 }],
		detail: 'src/changed.ts deep-imports src/other/common/x.ts',
		guidance: 'Import through the module barrel.',
	});

	const selected = selectStandardsFindings({ findings: [gated], changedFiles: ['src/changed.ts'] });

	// the refactor agent reads detail, guidance and the line spans, so every list
	// carries the finding itself
	expect(selected).toStrictEqual({ workList: [gated], advisories: [] });
});

test('selectStandardsFindings matches against every changed file, not only the first', () => {
	const findings: StandardsFinding[] = [
		finding({ siteKey: 'multi-export:src/first.ts', files: [{ path: 'src/first.ts' }] }),
		finding({ rule: 'barrel-star', siteKey: 'barrel-star:src/second/index.ts', files: [{ path: 'src/second/index.ts' }] }),
		finding({ siteKey: 'multi-export:src/third.ts', files: [{ path: 'src/third.ts' }] }),
	];

	const selected = selectStandardsFindings({ findings, changedFiles: ['src/first.ts', 'src/second/index.ts'] });

	// a later changed file selects just as a first one does, and barrel-star now
	// blocks like every other finding-severity rule
	expect(selected.workList.map((entry) => entry.siteKey)).toStrictEqual(['multi-export:src/first.ts', 'barrel-star:src/second/index.ts']);
});

test('selectStandardsFindings selects nothing when the run changed no files', () => {
	const findings: StandardsFinding[] = [
		finding({ siteKey: 'multi-export:src/a.ts', files: [{ path: 'src/a.ts' }] }),
		finding({ rule: 'size-function', severity: 'advisory', siteKey: 'size-function:src/a.ts', files: [{ path: 'src/a.ts', startLine: 5, endLine: 99 }] }),
	];

	const selected = selectStandardsFindings({ findings, changedFiles: [] });

	// an empty changed-file set touches nothing
	expect(selected).toStrictEqual({ workList: [], advisories: [] });
});

test('selectStandardsFindings: a folder site counts as changed when the run changed a file under it', () => {
	const crowded = finding({ rule: 'crowded-folder', siteKey: 'crowded-folder:src/appUI', files: [{ path: 'src/appUI' }] });

	// a changed-file list holds files, so equality alone would never match a
	// folder and the rule could never gate a run
	const selected = selectStandardsFindings({ findings: [crowded], changedFiles: ['src/appUI/Badge.tsx'] });

	// the folder finding itself lands in the work-list, whole and blocking
	expect(selected).toStrictEqual({ workList: [crowded], advisories: [] });
});

test('selectStandardsFindings: a folder site is matched at any depth beneath it', () => {
	const crowded = finding({ rule: 'crowded-folder', siteKey: 'crowded-folder:src/appUI', files: [{ path: 'src/appUI' }] });

	// containment is not "an immediate child" — a run that touched a file nested
	// several levels down still changed the folder the rule judged
	const selected = selectStandardsFindings({ findings: [crowded], changedFiles: ['src/appUI/parts/badge/Badge.tsx'] });

	expect(selected).toStrictEqual({ workList: [crowded], advisories: [] });
});

test('selectStandardsFindings: an advisory on a folder site is gated by the same containment', () => {
	const crowded = finding({ rule: 'crowded-folder', severity: 'advisory', siteKey: 'crowded-folder:src/appUI', files: [{ path: 'src/appUI' }] });

	const selected = selectStandardsFindings({ findings: [crowded], changedFiles: ['src/appUI/Badge.tsx'] });

	// severity decides which list it joins; containment decides whether it is
	// selected at all, and it applies to both lists alike
	expect(selected).toStrictEqual({ workList: [], advisories: [crowded] });
});

test('selectStandardsFindings: a folder site the run did not touch stays out', () => {
	const findings = [finding({ rule: 'crowded-folder', siteKey: 'crowded-folder:src/appUI', files: [{ path: 'src/appUI' }] })];

	const { workList } = selectStandardsFindings({ findings, changedFiles: ['src/features/runs/RunList.tsx'] });

	expect(workList).toStrictEqual([]);
});

test('selectStandardsFindings: a folder site matches by containment, so a name-prefix sibling never claims it', () => {
	const findings = [finding({ rule: 'crowded-folder', siteKey: 'crowded-folder:src/app', files: [{ path: 'src/app' }] })];

	// 'src/appUI/Badge.tsx' starts with 'src/app' as a string but sits in a
	// different folder — only 'src/app/' would be containment
	const { workList } = selectStandardsFindings({ findings, changedFiles: ['src/appUI/Badge.tsx'] });

	expect(workList).toStrictEqual([]);
});

test('selectStandardsFindings: a finding whose only site is a changed test file is gated like any other', () => {
	const onATestFile = finding({
		rule: 'test-mock-untyped',
		siteKey: 'test-mock-untyped:src/appUI/FadeIn.unit.test.tsx',
		files: [{ path: 'src/appUI/FadeIn.unit.test.tsx' }],
	});

	const selected = selectStandardsFindings({ findings: [onATestFile], changedFiles: ['src/appUI/FadeIn.unit.test.tsx'] });

	// nothing here knows a test file from a source file — the site is a changed
	// path, so the finding is work like any other
	expect(selected).toStrictEqual({ workList: [onATestFile], advisories: [] });
});

test('selectStandardsFindings: a finding that names no file is selected by neither list', () => {
	const siteless = finding({ rule: 'crowded-folder', siteKey: 'crowded-folder:src/appUI', files: [] });

	const selected = selectStandardsFindings({ findings: [siteless], changedFiles: ['src/appUI/Badge.tsx'] });

	// selection asks which of a finding's files the run changed, so a finding
	// with no files can never touch the run however blocking it is
	expect(selected).toStrictEqual({ workList: [], advisories: [] });
});
