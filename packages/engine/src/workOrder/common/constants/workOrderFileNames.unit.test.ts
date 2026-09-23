import { describe, expect, test } from '@jest/globals';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';

describe('workOrderFileNames', () => {
	test('workOrderFileNames: the record, its sidecar, the surfaced copy and the lock are the four state files', () => {
		// The four spellings are the whole contract: they are what lands on disk
		// beside a work order's plan folders and what a published attachment is
		// titled, so a reader that knows one name knows where the others are. The
		// keys stay as they were, because every caller reaches a name through one.
		const fileNames = workOrderFileNames;

		expect(fileNames).toStrictEqual({
			record: 'state.json',
			sync: 'state-sync.json',
			published: 'state.published.json',
			lock: 'state.lock',
		});
	});
});
