import { describe, expect, test } from '@jest/globals';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { findIntroducedFindings } from '#src/refactor/index.ts';

const finding = (overrides: Partial<StandardsFinding> & { siteKey: string }): StandardsFinding => ({
	rule: 'multi-export',
	severity: StandardsSeverity.Blocking,
	files: [{ path: 'src/a.ts' }],
	detail: '2 exports',
	...overrides,
});

/** A work-list finding that survived, and a blocking one that was never on the list. */
const setupMixedCheck = () => ({
	frozen: [finding({ siteKey: 'multi-export:src/a.ts' })],
	live: [
		finding({ siteKey: 'multi-export:src/a.ts' }),
		finding({ rule: 'explicit-return-type', siteKey: 'explicit-return-type:src/new.ts', files: [{ path: 'src/new.ts' }] }),
	],
});

describe('findIntroducedFindings', () => {
	test('a blocking finding absent from the work-list is the run’s own doing', () => {
		const { frozen, live } = setupMixedCheck();

		const introduced = findIntroducedFindings({ frozen, live, severity: StandardsSeverity.Blocking });

		expect(introduced.map((entry) => entry.siteKey)).toStrictEqual(['explicit-return-type:src/new.ts']);
	});

	test('a work-list finding still standing is a decline, never an introduction', () => {
		const frozen = [finding({ siteKey: 'multi-export:src/a.ts' })];

		const introduced = findIntroducedFindings({ frozen, live: frozen, severity: StandardsSeverity.Blocking });

		// the run was asked to fix it and did not — that is the human's call to
		// make, and calling it "introduced" would blame the run for the debt it
		// was pointed at
		expect(introduced).toStrictEqual([]);
	});

	test('an advisory the run created never fails the run — the closing check asks only about blocking work', () => {
		const introduced = findIntroducedFindings({
			frozen: [],
			live: [finding({ severity: StandardsSeverity.Advisory, rule: 'clone', siteKey: 'clone:src/new.ts' })],
			severity: StandardsSeverity.Blocking,
		});

		expect(introduced).toStrictEqual([]);
	});

	test('the same question asked of advisories finds the one a batch’s own edits introduced', () => {
		const introduced = findIntroducedFindings({
			frozen: [finding({ severity: StandardsSeverity.Advisory, rule: 'size-function', siteKey: 'size-function:src/a.ts' })],
			live: [
				finding({ severity: StandardsSeverity.Advisory, rule: 'size-function', siteKey: 'size-function:src/a.ts' }),
				finding({ severity: StandardsSeverity.Advisory, rule: 'single-return', siteKey: 'single-return:src/a.ts' }),
			],
			severity: StandardsSeverity.Advisory,
		});

		// the pre-edit review already showed the size advisory to the executor and
		// recorded its answer; only the shape problem the edit itself created is new
		expect(introduced.map((entry) => entry.rule)).toStrictEqual(['single-return']);
	});

	test('a blocking finding is not an introduced advisory — severity picks the question, not just the filter', () => {
		const introduced = findIntroducedFindings({ frozen: [], live: [finding({ siteKey: 'multi-export:src/new.ts' })], severity: StandardsSeverity.Advisory });

		expect(introduced).toStrictEqual([]);
	});

	test('a clean closing check introduces nothing', () => {
		const introduced = findIntroducedFindings({ frozen: [finding({ siteKey: 'multi-export:src/a.ts' })], live: [], severity: StandardsSeverity.Blocking });

		expect(introduced).toStrictEqual([]);
	});
});
