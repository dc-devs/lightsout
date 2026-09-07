import { describe, expect, test } from '@jest/globals';
import { ApprovedTestRecord } from '#src/contracts/index.ts';

/** The two shapes the record is allowed to take: a copy the run holds, or an approved absence. */
const setupRecord = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const record: Record<string, unknown> = {
		path: 'packages/engine/src/pipeline/steps/verifyStep.unit.test.ts',
		sha256: 'a'.repeat(64),
		...extra,
	};

	if (omit) {
		delete record[omit];
	}

	return { record };
};

describe('ApprovedTestRecord', () => {
	test('ApprovedTestRecord: a copy carries a 64-character hash, a removal carries the flag, and removed defaults to false', () => {
		const { record: copy } = setupRecord();
		const { record: removal } = setupRecord({ omit: 'sha256', extra: { removed: true } });
		const { record: shortHash } = setupRecord({ extra: { sha256: 'a'.repeat(63) } });
		const { record: noPath } = setupRecord({ extra: { path: '' } });

		const parsedCopy = ApprovedTestRecord.parse(copy);
		const parsedRemoval = ApprovedTestRecord.parse(removal);

		// a copy names the path and the hash of the bytes the run approved, and
		// says nothing was removed — the flag defaults rather than being written
		expect(parsedCopy).toStrictEqual({
			path: 'packages/engine/src/pipeline/steps/verifyStep.unit.test.ts',
			sha256: 'a'.repeat(64),
			removed: false,
		});
		// an approved removal is the flag alone: no copy exists and none is expected
		expect(parsedRemoval).toStrictEqual({
			path: 'packages/engine/src/pipeline/steps/verifyStep.unit.test.ts',
			removed: true,
		});
		// a hash of any other length is not a SHA-256 of an approved copy
		expect(ApprovedTestRecord.safeParse(shortHash).success).toBe(false);
		// a record without a path names no file, so it can approve nothing
		expect(ApprovedTestRecord.safeParse(noPath).success).toBe(false);
	});
});
