import { expect, describe, test } from '@jest/globals';
import { StandardsFinding } from '@/contracts';

const setupFinding = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const finding: Record<string, unknown> = {
		rule: 'clone',
		severity: 'finding',
		siteKey: 'clone:src/scan/runScan.ts:12',
		files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
		detail: 'a 36-line span repeated across two files',
		...extra,
	};

	if (omit) {
		delete finding[omit];
	}

	return { finding };
};

describe('StandardsFinding', () => {
	test('a located finding parses with its file span intact', () => {
		const { finding } = setupFinding();

		const parsed = StandardsFinding.parse(finding);

		expect(parsed).toStrictEqual({
			rule: 'clone',
			severity: 'finding',
			siteKey: 'clone:src/scan/runScan.ts:12',
			files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
			detail: 'a 36-line span repeated across two files',
		});
	});

	test('every rule the scan runs is a value a finding may carry', () => {
		for (const rule of ['filename-duplicate', 'clone', 'ast-duplicate', 'size', 'structure', 'dead-export', 'module-boundary', 'placement', 'barrel-hygiene']) {
			const { finding } = setupFinding({ extra: { rule } });

			const parsed = StandardsFinding.parse(finding);

			// ${rule} is one of the rules the baseline keys and the refactor
			// work-list batches by — the wire value is the durable name, not the tier it
			// sits in
			expect(parsed.rule).toBe(rule);
		}
	});

	test('rejects a rule outside the scanner\'s set', () => {
		for (const rule of ['complexity', 'Clone', '']) {
			const { finding } = setupFinding({ extra: { rule } });

			const result = StandardsFinding.safeParse(finding);

			// the enum closes the set — a finding naming a rule nothing runs would
			// batch into work no re-scan could ever resolve
			expect(result.success).toBe(false);
		}
	});

	test('both severities parse — the split the remediation loop reads', () => {
		for (const severity of ['finding', 'advisory']) {
			const { finding } = setupFinding({ extra: { severity } });

			const parsed = StandardsFinding.parse(finding);

			// ${severity} is a recorded severity: findings are acted on, advisories are
			// context only
			expect(parsed.severity).toBe(severity);
		}
	});

	test('rejects a severity outside the two-value set', () => {
		for (const severity of ['warning', 'Finding']) {
			const { finding } = setupFinding({ extra: { severity } });

			const result = StandardsFinding.safeParse(finding);

			// an unrecognized severity would be neither must-address nor advisory — the
			// read boundary refuses it rather than guessing
			expect(result.success).toBe(false);
		}
	});

	test('a whole-file finding parses with no line span', () => {
		const { finding } = setupFinding({ extra: { rule: 'dead-export', files: [{ path: 'src/scan/runScan.ts' }] } });

		const parsed = StandardsFinding.parse(finding);

		// startLine and endLine stay absent rather than defaulting to zero — a
		// structure or dead-export finding names a file, not a span
		expect(parsed.files).toStrictEqual([{ path: 'src/scan/runScan.ts' }]);
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

		const parsed = StandardsFinding.parse(finding);

		// a clone is only actionable with every site it appears at — the agent is
		// handed all of them
		expect(parsed.files).toStrictEqual([
			{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 },
			{ path: 'src/refactor/runBatch.ts', startLine: 90, endLine: 126 },
		]);
	});

	test('an empty files list parses — a finding may name a site key no path localizes', () => {
		const { finding } = setupFinding({ extra: { files: [] } });

		const parsed = StandardsFinding.parse(finding);

		// the array is required but not non-empty; readers iterate it rather than
		// indexing site zero
		expect(parsed.files).toStrictEqual([]);
	});

	test('rejects a file site with no path', () => {
		const { finding } = setupFinding({ extra: { files: [{ startLine: 12, endLine: 48 }] } });

		const result = StandardsFinding.safeParse(finding);

		// a span with no file points the refactor agent at nothing
		expect(result.success).toBe(false);
	});

	test('rejects line numbers given as numeric strings rather than coercing them', () => {
		for (const files of [[{ path: 'src/scan/runScan.ts', startLine: '12' }], [{ path: 'src/scan/runScan.ts', endLine: '48' }]]) {
			const { finding } = setupFinding({ extra: { files } });

			const result = StandardsFinding.safeParse(finding);

			// line numbers are compared and offset when a span is rendered; a string would
			// order as text
			expect(result.success).toBe(false);
		}
	});

	test('rejects a files value that is not an array', () => {
		const { finding } = setupFinding({ extra: { files: { path: 'src/scan/runScan.ts' } } });

		const result = StandardsFinding.safeParse(finding);

		// a single site object in place of the list is a malformed finding
		expect(result.success).toBe(false);
	});

	test('rule, severity, siteKey, and detail are each required', () => {
		for (const field of ['rule', 'severity', 'siteKey', 'detail']) {
			const { finding } = setupFinding({ omit: field });

			const result = StandardsFinding.safeParse(finding);

			// ${field} is required — the site key is the grouping key a re-scan checks for
			// resolution, and the detail is the only prose a human or agent reads
			expect(result.success).toBe(false);
		}
	});

	test('siteKey and detail are strings, not coerced from other types', () => {
		for (const extra of [{ siteKey: 42 }, { detail: ['a', 'b'] }]) {
			const { finding } = setupFinding({ extra });

			const result = StandardsFinding.safeParse(finding);

			// the site key is matched by identity against the baseline and the detail is
			// printed verbatim
			expect(result.success).toBe(false);
		}
	});

	test('guidance rides the finding verbatim when the rule supplies it', () => {
		const { finding } = setupFinding({ extra: { guidance: 'Extract the shared span into one module both files import.' } });

		const parsed = StandardsFinding.parse(finding);

		// guidance is printed into the refactor agent's brief as text — it survives the
		// read boundary unaltered or the agent is handed a bare measurement
		expect(parsed.guidance).toBe('Extract the shared span into one module both files import.');
	});

	test('rejects a non-string guidance when the field is present', () => {
		for (const guidance of [['extract the span'], 42]) {
			const { finding } = setupFinding({ extra: { guidance } });

			const result = StandardsFinding.safeParse(finding);

			// the field is optional, not free-form — a list or a number would print as
			// junk in the brief rather than as advice
			expect(result.success).toBe(false);
		}
	});

	test('keys the contract does not declare are stripped from the finding and from each site', () => {
		const { finding } = setupFinding({ extra: { tier: 1, files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48, tokens: 180 }] } });

		const parsed = StandardsFinding.parse(finding);

		// a finding holds the fields the contract declares, whatever else the rule
		// happened to know — the baseline stays a stable ledger across rule
		// versions
		expect(parsed).toStrictEqual({
			rule: 'clone',
			severity: 'finding',
			siteKey: 'clone:src/scan/runScan.ts:12',
			files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
			detail: 'a 36-line span repeated across two files',
		});
	});
});
