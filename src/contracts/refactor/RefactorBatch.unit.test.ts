import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RefactorBatch } from '@/contracts';

const setupBatch = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const finding = {
		detector: 'clone',
		severity: 'finding',
		cluster: 'clone:src/scan/runScan.ts:12',
		files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
		detail: 'a 36-line span repeated across two files',
	};
	const advisory = {
		detector: 'size',
		severity: 'advisory',
		cluster: 'size:src/scan/runScan.ts',
		files: [{ path: 'src/scan/runScan.ts' }],
		detail: 'the file is 240 lines against a 200-line guideline',
	};
	const batch: Record<string, unknown> = {
		id: 'batch-01:clone:src/scan',
		detector: 'clone',
		folder: 'src/scan',
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

		assert.deepEqual(parsed, {
			id: 'batch-01:clone:src/scan',
			detector: 'clone',
			folder: 'src/scan',
			findings: [finding],
			advisories: [advisory],
		});
	});

	test('id, detector, and folder are each required', () => {
		for (const field of ['id', 'detector', 'folder']) {
			const { batch } = setupBatch({ omit: field });

			const result = RefactorBatch.safeParse(batch);

			assert.equal(result.success, false, `${field} is required — the id is the manifest step a resume keys on, and the detector and folder are what make the batch one agent job`);
		}
	});

	test('findings and advisories are required rather than defaulting to empty', () => {
		for (const field of ['findings', 'advisories']) {
			const { batch } = setupBatch({ omit: field });

			const result = RefactorBatch.safeParse(batch);

			assert.equal(result.success, false, `${field} carries no default — a frozen work-list states the empty case explicitly rather than letting an absent key read as "none"`);
		}
	});

	test('an empty advisories list parses — a batch no advisory overlaps is still a batch', () => {
		const { batch } = setupBatch({ extra: { advisories: [] } });

		const parsed = RefactorBatch.parse(batch);

		assert.deepEqual(parsed.advisories, [], 'advisories are context, never the reason a batch exists');
	});

	test('an empty findings list parses — nothing in the schema forbids a batch with no must-address work', () => {
		const { batch } = setupBatch({ extra: { findings: [] } });

		const parsed = RefactorBatch.parse(batch);

		assert.deepEqual(parsed.findings, [], 'the contract admits the shape; whether such a batch is ever built is the work-list builder\'s decision, not the schema\'s');
	});

	test('the two arrays are split by membership, not by the severity each entry carries', () => {
		const { batch, advisory } = setupBatch();

		const parsed = RefactorBatch.parse({ ...batch, advisories: [{ ...advisory, severity: 'finding' }] });

		assert.equal(parsed.advisories[0]?.severity, 'finding', 'the schema never cross-checks severity against the array — which list an entry sits in is what decides whether the re-scan blocks on it');
		assert.equal(parsed.findings[0]?.cluster, 'clone:src/scan/runScan.ts:12', 'the must-address list is untouched by what the advisory list holds');
	});

	test('one malformed finding rejects the whole batch', () => {
		const { batch, finding } = setupBatch();

		const result = RefactorBatch.safeParse({ ...batch, findings: [{ ...finding, detector: 'complexity' }] });

		assert.equal(result.success, false, 'a batch is dispatched whole, so a half-readable work-list is refused at the read boundary rather than sending an agent at work no re-scan could check');
	});

	test('a malformed advisory rejects the batch just as a malformed finding does', () => {
		const { batch } = setupBatch({ extra: { advisories: [{ detector: 'size', severity: 'advisory', cluster: 'size:src/scan/runScan.ts' }] } });

		const result = RefactorBatch.safeParse(batch);

		assert.equal(result.success, false, 'advisories never block the run, but they are held to the same shape — they are printed into the agent\'s prompt');
	});

	test('rejects a findings or advisories value that is not an array', () => {
		const { batch, finding, advisory } = setupBatch();

		for (const malformed of [{ ...batch, findings: finding }, { ...batch, advisories: advisory }]) {
			const result = RefactorBatch.safeParse(malformed);

			assert.equal(result.success, false, 'a single entry in place of the list is a malformed batch');
		}
	});

	test('the batch detector is a plain label, so a batch groups whatever the scan named', () => {
		const { batch } = setupBatch({ extra: { detector: 'barrel-hygiene', findings: [] } });

		const parsed = RefactorBatch.parse(batch);

		assert.equal(parsed.detector, 'barrel-hygiene', 'the detector is echoed into the step id as text; the closed detector set is enforced on the findings themselves');
	});

	test('the (root) sentinel folder parses like any other grouping folder', () => {
		const { batch } = setupBatch({ extra: { id: 'batch-02:structure:(root)', folder: '(root)' } });

		const parsed = RefactorBatch.parse(batch);

		assert.equal(parsed.folder, '(root)', 'a finding under no package and no top segment still groups somewhere — the sentinel is a folder value, not an absent one');
	});

	test('id, detector, and folder are strings, not coerced from other types', () => {
		for (const extra of [{ id: 1 }, { detector: ['clone'] }, { folder: null }]) {
			const { batch } = setupBatch({ extra });

			const result = RefactorBatch.safeParse(batch);

			assert.equal(result.success, false, 'all three are printed and matched as text — the id keys the manifest step a resume looks up');
		}
	});

	test('keys the contract does not declare are stripped from the batch and from its findings', () => {
		const { batch, finding, advisory } = setupBatch();

		const parsed = RefactorBatch.parse({ ...batch, attempts: 2, findings: [{ ...finding, tokens: 180 }] });

		assert.deepEqual(
			parsed,
			{
				id: 'batch-01:clone:src/scan',
				detector: 'clone',
				folder: 'src/scan',
				findings: [
					{
						detector: 'clone',
						severity: 'finding',
						cluster: 'clone:src/scan/runScan.ts:12',
						files: [{ path: 'src/scan/runScan.ts', startLine: 12, endLine: 48 }],
						detail: 'a 36-line span repeated across two files',
					},
				],
				advisories: [advisory],
			},
			'the persisted work-list holds the fields the contract declares — batch progress lives in the manifest step, never smuggled onto the frozen batch',
		);
	});
});
