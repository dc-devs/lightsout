import { expect, describe, test } from '@jest/globals';
import { RefactorBatch } from '@/contracts';

const setupBatch = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const finding = {
		rule: 'clone',
		severity: 'finding',
		siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
		files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
		detail: 'a 36-line span repeated across two files',
	};
	const advisory = {
		rule: 'size-file',
		severity: 'advisory',
		siteKey: 'size-file:src/standardsCheck/runStandardsCheck.ts',
		files: [{ path: 'src/standardsCheck/runStandardsCheck.ts' }],
		detail: 'the file is 240 lines against a 200-line guideline',
	};
	const batch: Record<string, unknown> = {
		id: 'batch-01:clone:src/standardsCheck',
		rule: 'clone',
		folder: 'src/standardsCheck',
		findings: [finding],
		advisories: [advisory],
		...extra,
	};

	if (omit) {
		delete batch[omit];
	}

	return { batch, finding, advisory };
};

describe('RefactorBatch', () => {
	test('a batch parses with its must-address findings and its overlapping advisories side by side', () => {
		const { batch, finding, advisory } = setupBatch();

		const parsed = RefactorBatch.parse(batch);

		expect(parsed).toStrictEqual({
			id: 'batch-01:clone:src/standardsCheck',
			rule: 'clone',
			folder: 'src/standardsCheck',
			findings: [finding],
			advisories: [advisory],
		});
	});

	test('id, rule, and folder are each required', () => {
		for (const field of ['id', 'rule', 'folder']) {
			const { batch } = setupBatch({ omit: field });

			const result = RefactorBatch.safeParse(batch);

			// ${field} is required — the id is the manifest step a resume keys on, and the
			// rule and folder are what make the batch one agent job
			expect(result.success).toBe(false);
		}
	});

	test('findings and advisories are required rather than defaulting to empty', () => {
		for (const field of ['findings', 'advisories']) {
			const { batch } = setupBatch({ omit: field });

			const result = RefactorBatch.safeParse(batch);

			// ${field} carries no default — a frozen work-list states the empty case
			// explicitly rather than letting an absent key read as "none"
			expect(result.success).toBe(false);
		}
	});

	test('an empty advisories list parses — a batch no advisory overlaps is still a batch', () => {
		const { batch } = setupBatch({ extra: { advisories: [] } });

		const parsed = RefactorBatch.parse(batch);

		// advisories are context, never the reason a batch exists
		expect(parsed.advisories).toStrictEqual([]);
	});

	test('an empty findings list parses — nothing in the schema forbids a batch with no must-address work', () => {
		const { batch } = setupBatch({ extra: { findings: [] } });

		const parsed = RefactorBatch.parse(batch);

		// the contract admits the shape; whether such a batch is ever built is the
		// work-list builder's decision, not the schema's
		expect(parsed.findings).toStrictEqual([]);
	});

	test('the two arrays are split by membership, not by the severity each entry carries', () => {
		const { batch, advisory } = setupBatch();

		const parsed = RefactorBatch.parse({ ...batch, advisories: [{ ...advisory, severity: 'finding' }] });

		// the schema never cross-checks severity against the array — which list an
		// entry sits in is what decides whether the re-check blocks on it
		expect(parsed.advisories[0]?.severity).toBe('finding');
		// the must-address list is untouched by what the advisory list holds
		expect(parsed.findings[0]?.siteKey).toBe('clone:src/standardsCheck/runStandardsCheck.ts:12');
	});

	test('one malformed finding rejects the whole batch', () => {
		const { batch, finding } = setupBatch();

		const result = RefactorBatch.safeParse({ ...batch, findings: [{ ...finding, rule: 'complexity' }] });

		// a batch is dispatched whole, so a half-readable work-list is refused at the
		// read boundary rather than sending an agent at work no re-check could verify
		expect(result.success).toBe(false);
	});

	test('a malformed advisory rejects the batch just as a malformed finding does', () => {
		const { batch } = setupBatch({ extra: { advisories: [{ rule: 'size-file', severity: 'advisory', siteKey: 'size-file:src/standardsCheck/runStandardsCheck.ts' }] } });

		const result = RefactorBatch.safeParse(batch);

		// advisories never block the run, but they are held to the same shape — they
		// are printed into the agent's prompt
		expect(result.success).toBe(false);
	});

	test('rejects a findings or advisories value that is not an array', () => {
		const { batch, finding, advisory } = setupBatch();

		for (const malformed of [{ ...batch, findings: finding }, { ...batch, advisories: advisory }]) {
			const result = RefactorBatch.safeParse(malformed);

			// a single entry in place of the list is a malformed batch
			expect(result.success).toBe(false);
		}
	});

	test('the batch rule is a plain label, so a batch groups whatever the standards check named', () => {
		const { batch } = setupBatch({ extra: { rule: 'barrel-hygiene', findings: [] } });

		const parsed = RefactorBatch.parse(batch);

		// the rule is echoed into the step id as text; the closed rule set is
		// enforced on the findings themselves
		expect(parsed.rule).toBe('barrel-hygiene');
	});

	test('the (root) sentinel folder parses like any other grouping folder', () => {
		const { batch } = setupBatch({ extra: { id: 'batch-02:structure:(root)', folder: '(root)' } });

		const parsed = RefactorBatch.parse(batch);

		// a finding under no package and no top segment still groups somewhere — the
		// sentinel is a folder value, not an absent one
		expect(parsed.folder).toBe('(root)');
	});

	test('id, rule, and folder are strings, not coerced from other types', () => {
		for (const extra of [{ id: 1 }, { rule: ['clone'] }, { folder: null }]) {
			const { batch } = setupBatch({ extra });

			const result = RefactorBatch.safeParse(batch);

			// all three are printed and matched as text — the id keys the manifest step a
			// resume looks up
			expect(result.success).toBe(false);
		}
	});

	test('keys the contract does not declare are stripped from the batch and from its findings', () => {
		const { batch, finding, advisory } = setupBatch();

		const parsed = RefactorBatch.parse({ ...batch, attempts: 2, findings: [{ ...finding, tokens: 180 }] });

		// the persisted work-list holds the fields the contract declares — batch
		// progress lives in the manifest step, never smuggled onto the frozen batch
		expect(parsed).toStrictEqual({
			id: 'batch-01:clone:src/standardsCheck',
			rule: 'clone',
			folder: 'src/standardsCheck',
			findings: [
				{
					rule: 'clone',
					severity: 'finding',
					siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
					files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
					detail: 'a 36-line span repeated across two files',
				},
			],
			advisories: [advisory],
		});
	});
});
