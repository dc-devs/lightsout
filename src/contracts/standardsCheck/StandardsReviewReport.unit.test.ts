import { expect, describe, test } from '@jest/globals';
import { StandardsReviewReport } from '@/contracts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const report = {
		findings: [{ rule: 'path-aliases', files: [{ path: 'src/a.ts', startLine: 3, endLine: 3 }], detail: 'a relative import in an aliased package', guidance: 'use the alias' }],
		...overrides,
	};

	return { report };
};

describe('StandardsReviewReport', () => {
	test('a reported violation parses with its site, its detail and its guidance', () => {
		const { report } = setupReport();

		expect(StandardsReviewReport.parse(report)).toStrictEqual(report);
	});

	test('an empty list parses — reporting nothing is a correct and common answer', () => {
		const { report } = setupReport({ findings: [] });

		expect(StandardsReviewReport.parse(report)).toStrictEqual({ findings: [] });
	});

	test('guidance and line numbers are optional — a reviewer with none still reports the site', () => {
		const { report } = setupReport({ findings: [{ rule: 'path-aliases', files: [{ path: 'src/a.ts' }], detail: 'a relative import' }] });

		expect(StandardsReviewReport.parse(report).findings[0]).toStrictEqual({ rule: 'path-aliases', files: [{ path: 'src/a.ts' }], detail: 'a relative import' });
	});

	test('rule is a free string — the ids belong to the loaded packages, which the contract cannot know', () => {
		const { report } = setupReport({ findings: [{ rule: 'a-rule-no-package-declares', files: [{ path: 'src/a.ts' }], detail: 'made up' }] });

		// the contract accepts it; the runner drops it against the loaded rules,
		// where the valid ids actually exist
		expect(StandardsReviewReport.safeParse(report).success).toBe(true);
	});

	test('a severity or site key the agent volunteered is stripped — both are the engine’s to stamp', () => {
		const { report } = setupReport({
			findings: [{ rule: 'path-aliases', severity: 'blocking', siteKey: 'invented', files: [{ path: 'src/a.ts' }], detail: 'a relative import' }],
		});

		expect(StandardsReviewReport.parse(report).findings[0]).toStrictEqual({ rule: 'path-aliases', files: [{ path: 'src/a.ts' }], detail: 'a relative import' });
	});

	test('every declared field is required — no default invents a rule, a site list, or a detail', () => {
		for (const field of ['rule', 'files', 'detail']) {
			const { report } = setupReport({ findings: [{ rule: 'path-aliases', files: [{ path: 'src/a.ts' }], detail: 'a relative import', [field]: undefined }] });

			// ${field} is required — a finding missing one of these cannot be sited or
			// read, and a default would fabricate the missing half
			expect(StandardsReviewReport.safeParse(report).success).toBe(false);
		}
	});

	test('a site without a path is refused — a finding the engine cannot key is not reportable', () => {
		const { report } = setupReport({ findings: [{ rule: 'path-aliases', files: [{ startLine: 3 }], detail: 'a relative import' }] });

		// the site key is derived from the first file's path, so a pathless site
		// leaves the finding with no address
		expect(StandardsReviewReport.safeParse(report).success).toBe(false);
	});

	test('line numbers must be numbers — a reviewer quoting them as text is refused', () => {
		for (const field of ['startLine', 'endLine']) {
			const { report } = setupReport({ findings: [{ rule: 'path-aliases', files: [{ path: 'src/a.ts', [field]: '3' }], detail: 'a relative import' }] });

			expect(StandardsReviewReport.safeParse(report).success).toBe(false);
		}
	});

	test('refuses a message that carries no findings list at all', () => {
		for (const value of [undefined, null, {}, 'no violations found', { findings: 'none' }]) {
			// a reviewer that answered in prose has not answered — the runner retries
			// the re-emit rather than reading silence as a clean bill of health
			expect(StandardsReviewReport.safeParse(value).success).toBe(false);
		}
	});
});
