import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ScanFinding } from '@/contracts';

const setupFinding = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const finding: Record<string, unknown> = {
		detector: 'clone',
		severity: 'finding',
		cluster: 'clone:src/scan/runScan.ts:12',
		files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
		detail: 'a 36-line span repeated across two files',
		...extra,
	};

	if (omit) {
		delete finding[omit];
	}

	return { finding };
};

describe('ScanFinding', () => {
	test('a located finding parses with its file span intact', () => {
		const { finding } = setupFinding();

		const parsed = ScanFinding.parse(finding);

		assert.deepEqual(parsed, {
			detector: 'clone',
			severity: 'finding',
			cluster: 'clone:src/scan/runScan.ts:12',
			files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
			detail: 'a 36-line span repeated across two files',
		});
	});

	test('every detector the scan runs is a value a finding may carry', () => {
		for (const detector of ['filename-duplicate', 'clone', 'ast-duplicate', 'size', 'structure', 'dead-export', 'module-boundary', 'placement', 'barrel-hygiene']) {
			const { finding } = setupFinding({ extra: { detector } });

			const parsed = ScanFinding.parse(finding);

			assert.equal(parsed.detector, detector, `${detector} is one of the detectors the baseline keys and the refactor work-list batches by — the wire value is the durable name, not the tier it sits in`);
		}
	});

	test('rejects a detector outside the scanner\'s set', () => {
		for (const detector of ['complexity', 'Clone', '']) {
			const { finding } = setupFinding({ extra: { detector } });

			const result = ScanFinding.safeParse(finding);

			assert.equal(result.success, false, 'the enum closes the set — a finding naming a detector nothing runs would batch into work no re-scan could ever resolve');
		}
	});

	test('both severities parse — the split the remediation loop reads', () => {
		for (const severity of ['finding', 'advisory']) {
			const { finding } = setupFinding({ extra: { severity } });

			const parsed = ScanFinding.parse(finding);

			assert.equal(parsed.severity, severity, `${severity} is a recorded severity: findings are acted on, advisories are context only`);
		}
	});

	test('rejects a severity outside the two-value set', () => {
		for (const severity of ['warning', 'Finding']) {
			const { finding } = setupFinding({ extra: { severity } });

			const result = ScanFinding.safeParse(finding);

			assert.equal(result.success, false, 'an unrecognized severity would be neither must-address nor advisory — the read boundary refuses it rather than guessing');
		}
	});

	test('a whole-file finding parses with no line span', () => {
		const { finding } = setupFinding({ extra: { detector: 'dead-export', files: [{ path: 'src/scan/runScan.ts' }] } });

		const parsed = ScanFinding.parse(finding);

		assert.deepEqual(parsed.files, [{ path: 'src/scan/runScan.ts' }], 'startLine and endLine stay absent rather than defaulting to zero — a structure or dead-export finding names a file, not a span');
	});

	test('a finding spanning several files keeps every site in order', () => {
		const { finding } = setupFinding({
			extra: {
				files: [
					{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 },
					{ path: 'src/refactor/runBatch.ts', startLine: 90, endLine: 126 },
				],
			},
		});

		const parsed = ScanFinding.parse(finding);

		assert.deepEqual(
			parsed.files,
			[
				{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 },
				{ path: 'src/refactor/runBatch.ts', startLine: 90, endLine: 126 },
			],
			'a clone is only actionable with every site it appears at — the agent is handed all of them',
		);
	});

	test('an empty files list parses — a finding may name a cluster no path localizes', () => {
		const { finding } = setupFinding({ extra: { files: [] } });

		const parsed = ScanFinding.parse(finding);

		assert.deepEqual(parsed.files, [], 'the array is required but not non-empty; readers iterate it rather than indexing site zero');
	});

	test('rejects a file site with no path', () => {
		const { finding } = setupFinding({ extra: { files: [{ startLine: 12, endLine: 48 }] } });

		const result = ScanFinding.safeParse(finding);

		assert.equal(result.success, false, 'a span with no file points the refactor agent at nothing');
	});

	test('rejects line numbers given as numeric strings rather than coercing them', () => {
		for (const files of [[{ path: 'src/scan/runScan.ts', startLine: '12' }], [{ path: 'src/scan/runScan.ts', endLine: '48' }]]) {
			const { finding } = setupFinding({ extra: { files } });

			const result = ScanFinding.safeParse(finding);

			assert.equal(result.success, false, 'line numbers are compared and offset when a span is rendered; a string would order as text');
		}
	});

	test('rejects a files value that is not an array', () => {
		const { finding } = setupFinding({ extra: { files: { path: 'src/scan/runScan.ts' } } });

		const result = ScanFinding.safeParse(finding);

		assert.equal(result.success, false, 'a single site object in place of the list is a malformed finding');
	});

	test('detector, severity, cluster, and detail are each required', () => {
		for (const field of ['detector', 'severity', 'cluster', 'detail']) {
			const { finding } = setupFinding({ omit: field });

			const result = ScanFinding.safeParse(finding);

			assert.equal(result.success, false, `${field} is required — the cluster is the grouping key a re-scan checks for resolution, and the detail is the only prose a human or agent reads`);
		}
	});

	test('cluster and detail are strings, not coerced from other types', () => {
		for (const extra of [{ cluster: 42 }, { detail: ['a', 'b'] }]) {
			const { finding } = setupFinding({ extra });

			const result = ScanFinding.safeParse(finding);

			assert.equal(result.success, false, 'the cluster is matched by identity against the baseline and the detail is printed verbatim');
		}
	});

	test('keys the contract does not declare are stripped from the finding and from each site', () => {
		const { finding } = setupFinding({ extra: { tier: 1, files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48, tokens: 180 }] } });

		const parsed = ScanFinding.parse(finding);

		assert.deepEqual(
			parsed,
			{
				detector: 'clone',
				severity: 'finding',
				cluster: 'clone:src/scan/runScan.ts:12',
				files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
				detail: 'a 36-line span repeated across two files',
			},
			'a finding holds the fields the contract declares, whatever else the detector happened to know — the baseline stays a stable ledger across detector versions',
		);
	});
});
