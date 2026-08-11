import { describe, expect, test } from '@jest/globals';
import { StandardsFinding, StandardsSeverity } from '@/contracts';

const setupFinding = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const finding: Record<string, unknown> = {
		rule: 'clone',
		severity: 'blocking',
		siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
		files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
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
			severity: 'blocking',
			siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
			files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
			detail: 'a 36-line span repeated across two files',
		});
	});

	test('every rule the standards check runs is a value a finding may carry', () => {
		for (const rule of [
			'name-duplicate',
			'name-synonym',
			'clone',
			'ast-duplicate',
			'size-file',
			'size-function',
			'multi-export',
			'filename-mismatch',
			'domain-graduation',
			'folder-census',
			'dead-export',
			'test-only-export',
			'barrel-only-export',
			'module-boundary',
			'placement',
			'barrel-star',
			'barrel-dead-entry',
			'test-mock-prefix',
			'test-mock-return-in-hook',
			'test-mock-untyped',
			'test-mock-wrapper-untyped',
			'test-shared-let',
			'test-assert-in-hook',
			'test-nested-describe',
			'test-manual-mock-cleanup',
			'test-strict-equal-matcher',
			'test-multiple-setups',
			'test-mega-factory',
			'path-banned-module-name',
			'path-common-flat',
			'path-common-barrel',
			'path-test-in-tests-folder',
			'path-test-not-colocated',
			'path-test-support-in-src',
			'path-test-untested-subject-not-public',
			'path-folder-casing',
			'path-domain-folder-single-file',
		]) {
			const { finding } = setupFinding({ extra: { rule } });

			const parsed = StandardsFinding.parse(finding);

			// ${rule} is one of the rules the baseline keys and the refactor
			// work-list batches by — the wire value is the durable name, not the tier it
			// sits in
			expect(parsed.rule).toBe(rule);
		}
	});

	test('a rule id a third-party standards package declares parses like any other', () => {
		for (const rule of ['house-style-no-default-export', 'complexity']) {
			const { finding } = setupFinding({ extra: { rule } });

			const parsed = StandardsFinding.parse(finding);

			// rule identity belongs to the loaded packages, so this boundary cannot
			// hold a closed list without refusing every package but the bundled one.
			// The typo protection moved to `resolvePackageRuleStates`, which is the
			// first place the valid ids are known
			expect(parsed.rule).toBe(rule);
		}
	});

	test('ids the closed list used to refuse now parse — a casing variant and the empty id included', () => {
		for (const rule of ['Clone', '']) {
			const { finding } = setupFinding({ extra: { rule } });

			const parsed = StandardsFinding.parse(finding);

			// the read boundary no longer narrows the id at all: it cannot tell a typo
			// from a package's own rule name, so it keeps the value verbatim and leaves
			// the id check to `resolvePackageRuleStates`, which knows the loaded ids
			expect(parsed.rule).toBe(rule);
		}
	});

	test('rejects a rule that is not a string at all', () => {
		for (const rule of [42, ['clone'], { id: 'clone' }]) {
			const { finding } = setupFinding({ extra: { rule } });

			const result = StandardsFinding.safeParse(finding);

			// the id is the baseline key and the batch id — a non-string would render
			// as junk in both
			expect(result.success).toBe(false);
		}
	});

	test('both severities parse — the split the remediation loop reads', () => {
		for (const severity of ['blocking', 'advisory']) {
			const { finding } = setupFinding({ extra: { severity } });

			const parsed = StandardsFinding.parse(finding);

			// ${severity} is a recorded severity: findings are acted on, advisories are
			// context only
			expect(parsed.severity).toBe(severity);
		}
	});

	test('rejects a severity outside the two REPORTING values, `off` included', () => {
		// `off` is a configuration state — a rule a repo switched off emits nothing,
		// so a persisted finding carrying it would be a contradiction
		for (const severity of ['warning', 'Finding', 'off']) {
			const { finding } = setupFinding({ extra: { severity } });

			const result = StandardsFinding.safeParse(finding);

			// an unrecognized severity would be neither must-address nor advisory — the
			// read boundary refuses it rather than guessing
			expect(result.success).toBe(false);
		}
	});

	test('the severity vocabulary is three values, only two of which reach a finding', () => {
		const severities = [...Object.values(StandardsSeverity)].sort();

		// `off` is the third: the value a repo writes against a rule id to stop the
		// rule running. It belongs to the configuration vocabulary, so widening the
		// shared list must never widen what a persisted finding may carry
		expect(severities).toStrictEqual(['advisory', 'blocking', 'off']);
	});

	test('a whole-file finding parses with no line span', () => {
		const { finding } = setupFinding({ extra: { rule: 'dead-export', files: [{ path: 'src/standardsCheck/runStandardsCheck.ts' }] } });

		const parsed = StandardsFinding.parse(finding);

		// startLine and endLine stay absent rather than defaulting to zero — a
		// structure or dead-export finding names a file, not a span
		expect(parsed.files).toStrictEqual([{ path: 'src/standardsCheck/runStandardsCheck.ts' }]);
	});

	test('a finding spanning several files keeps every site in order', () => {
		const { finding } = setupFinding({
			extra: {
				files: [
					{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 },
					{ path: 'src/refactor/runBatch.ts', startLine: 90, endLine: 126 },
				],
			},
		});

		const parsed = StandardsFinding.parse(finding);

		// a clone is only actionable with every site it appears at — the agent is
		// handed all of them
		expect(parsed.files).toStrictEqual([
			{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 },
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
		for (const files of [
			[{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: '12' }],
			[{ path: 'src/standardsCheck/runStandardsCheck.ts', endLine: '48' }],
		]) {
			const { finding } = setupFinding({ extra: { files } });

			const result = StandardsFinding.safeParse(finding);

			// line numbers are compared and offset when a span is rendered; a string would
			// order as text
			expect(result.success).toBe(false);
		}
	});

	test('rejects a files value that is not an array', () => {
		const { finding } = setupFinding({ extra: { files: { path: 'src/standardsCheck/runStandardsCheck.ts' } } });

		const result = StandardsFinding.safeParse(finding);

		// a single site object in place of the list is a malformed finding
		expect(result.success).toBe(false);
	});

	test('rejects a finding with no files list at all', () => {
		const { finding } = setupFinding({ omit: 'files' });

		const result = StandardsFinding.safeParse(finding);

		// the list is required even when it is empty — readers iterate it
		// unconditionally, so an absent one would throw at the first site render
		expect(result.success).toBe(false);
	});

	test('rule, severity, siteKey, and detail are each required', () => {
		for (const field of ['rule', 'severity', 'siteKey', 'detail']) {
			const { finding } = setupFinding({ omit: field });

			const result = StandardsFinding.safeParse(finding);

			// ${field} is required — the site key is the grouping key a re-check looks for
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
		const { finding } = setupFinding({
			extra: { tier: 1, files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48, tokens: 180 }] },
		});

		const parsed = StandardsFinding.parse(finding);

		// a finding holds the fields the contract declares, whatever else the rule
		// happened to know — the baseline stays a stable ledger across rule
		// versions
		expect(parsed).toStrictEqual({
			rule: 'clone',
			severity: 'blocking',
			siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
			files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
			detail: 'a 36-line span repeated across two files',
		});
	});
});
