import { describe, expect, test } from '@jest/globals';
import { RawStandardsFinding } from '@/contracts';

const setupRawFinding = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const finding: Record<string, unknown> = {
		siteKey: 'size-file:src/standardsPackages/loadStandardsPackage.ts',
		files: [{ path: 'src/standardsPackages/loadStandardsPackage.ts', startLine: 1, endLine: 214 }],
		detail: 'a 214-line file against a 200-line limit',
		...extra,
	};

	if (omit) {
		delete finding[omit];
	}

	return { finding };
};

describe('RawStandardsFinding', () => {
	test('a located finding parses with its file span intact and no guidance key', () => {
		const { finding } = setupRawFinding();

		const parsed = RawStandardsFinding.parse(finding);

		// guidance is optional: a check that supplies none leaves the key absent
		// rather than carrying an empty string the brief would print as a blank line
		expect(parsed).toStrictEqual({
			siteKey: 'size-file:src/standardsPackages/loadStandardsPackage.ts',
			files: [{ path: 'src/standardsPackages/loadStandardsPackage.ts', startLine: 1, endLine: 214 }],
			detail: 'a 214-line file against a 200-line limit',
		});
	});

	test('a rule id and a severity a check names itself are dropped rather than carried', () => {
		const { finding } = setupRawFinding({ extra: { rule: 'size-file', severity: 'blocking' } });

		const parsed = RawStandardsFinding.parse(finding);

		// this is the whole difference between a raw finding and a StandardsFinding:
		// the rule id comes from the folder the check was loaded from and the
		// severity from front matter under any config override, so a check that
		// names either could name it wrong
		expect(parsed).toStrictEqual({
			siteKey: 'size-file:src/standardsPackages/loadStandardsPackage.ts',
			files: [{ path: 'src/standardsPackages/loadStandardsPackage.ts', startLine: 1, endLine: 214 }],
			detail: 'a 214-line file against a 200-line limit',
		});
	});

	test('guidance rides the finding verbatim when the check supplies it', () => {
		const { finding } = setupRawFinding({ extra: { guidance: 'Split the file along the seam its two exports already draw.' } });

		const parsed = RawStandardsFinding.parse(finding);

		// guidance is printed into the refactor agent's brief as text — it survives
		// the read boundary unaltered or the agent is handed a bare measurement
		expect(parsed.guidance).toBe('Split the file along the seam its two exports already draw.');
	});

	test('a whole-file finding parses with no line span', () => {
		const { finding } = setupRawFinding({ extra: { files: [{ path: 'src/standardsPackages/index.ts' }] } });

		const parsed = RawStandardsFinding.parse(finding);

		// startLine and endLine stay absent rather than defaulting to zero — a
		// structure rule names a file, not a span
		expect(parsed.files).toStrictEqual([{ path: 'src/standardsPackages/index.ts' }]);
	});

	test('a site may carry a start line with no end line', () => {
		const { finding } = setupRawFinding({ extra: { files: [{ path: 'src/standardsPackages/index.ts', startLine: 40 }] } });

		const parsed = RawStandardsFinding.parse(finding);

		// the two line fields are independently optional — a rule that can point at
		// where something begins but not where it ends still gets to say so
		expect(parsed.files).toStrictEqual([{ path: 'src/standardsPackages/index.ts', startLine: 40 }]);
	});

	test('a finding spanning several files keeps every site in order', () => {
		const { finding } = setupRawFinding({
			extra: {
				files: [
					{ path: 'src/standardsPackages/loadStandardsPackage.ts', startLine: 12, endLine: 48 },
					{ path: 'src/standardsPackages/buildStandardsDocuments.ts', startLine: 90, endLine: 126 },
				],
			},
		});

		const parsed = RawStandardsFinding.parse(finding);

		// a duplication finding is only actionable with every site it appears at —
		// the agent is handed all of them, in the order the check reported them
		expect(parsed.files).toStrictEqual([
			{ path: 'src/standardsPackages/loadStandardsPackage.ts', startLine: 12, endLine: 48 },
			{ path: 'src/standardsPackages/buildStandardsDocuments.ts', startLine: 90, endLine: 126 },
		]);
	});

	test('an empty files list parses — a check may name a site key no path localizes', () => {
		const { finding } = setupRawFinding({ extra: { files: [] } });

		const parsed = RawStandardsFinding.parse(finding);

		// the array is required but not non-empty; readers iterate it rather than
		// indexing site zero
		expect(parsed.files).toStrictEqual([]);
	});

	test('keys a site declares beyond path and lines are stripped', () => {
		const { finding } = setupRawFinding({
			extra: { files: [{ path: 'src/standardsPackages/loadStandardsPackage.ts', startLine: 1, endLine: 214, tokens: 180 }] },
		});

		const parsed = RawStandardsFinding.parse(finding);

		// a check may know more than the contract declares; what crosses the
		// boundary is the same shape whatever the check measured
		expect(parsed.files).toStrictEqual([{ path: 'src/standardsPackages/loadStandardsPackage.ts', startLine: 1, endLine: 214 }]);
	});

	test.each([{ field: 'siteKey' }, { field: 'files' }, { field: 'detail' }])('rejects a finding with no $field', ({ field }) => {
		const { finding } = setupRawFinding({ omit: field });

		const result = RawStandardsFinding.safeParse(finding);

		// the site key is the grouping key a re-check looks for resolution under,
		// the detail is the only prose a human or agent reads, and the files list
		// is iterated unconditionally even when empty
		expect(result.success).toBe(false);
	});

	test.each([
		{ label: 'a numeric siteKey', extra: { siteKey: 42 } },
		{ label: 'a detail given as a list', extra: { detail: ['a', 'b'] } },
		{ label: 'a guidance given as a list', extra: { guidance: ['split the file'] } },
		{ label: 'a numeric guidance', extra: { guidance: 42 } },
	])('rejects $label rather than coercing it to text', ({ extra }) => {
		const { finding } = setupRawFinding({ extra });

		const result = RawStandardsFinding.safeParse(finding);

		// the site key is matched by identity against the recorded ledger and the
		// prose fields are printed verbatim — a list or a number would print as junk
		expect(result.success).toBe(false);
	});

	test.each([
		{ label: 'a site with no path', files: [{ startLine: 12, endLine: 48 }] },
		{ label: 'a startLine given as a numeric string', files: [{ path: 'src/a.ts', startLine: '12' }] },
		{ label: 'an endLine given as a numeric string', files: [{ path: 'src/a.ts', endLine: '48' }] },
		{ label: 'a single site object in place of the list', files: { path: 'src/a.ts' } },
	])('rejects $label', ({ files }) => {
		const { finding } = setupRawFinding({ extra: { files } });

		const result = RawStandardsFinding.safeParse(finding);

		// a span with no file points the refactor agent at nothing, and line numbers
		// are compared and offset when a span is rendered — a string would order as
		// text
		expect(result.success).toBe(false);
	});
});
