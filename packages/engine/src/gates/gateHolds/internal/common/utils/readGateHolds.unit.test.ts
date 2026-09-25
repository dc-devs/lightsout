import { existsSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import { readGateHolds } from '#src/gates/gateHolds/internal/common/utils/readGateHolds.ts';
import { buildGateHold } from '#tests/helpers/buildGateHold.ts';
import { setupGateHoldsFolder } from '#tests/helpers/setupGateHoldsFolder.ts';

describe('readGateHolds', () => {
	test('answers an empty map when nothing has ever been held', async () => {
		const { cwd, holdsDir } = setupGateHoldsFolder();

		const holds = await readGateHolds({ cwd });

		// a repository that has never timed out has no folder at all, and that is the
		// ordinary case rather than an error — every caller gets one shape, so none
		// of them spells a "nothing here" branch of its own
		expect({ holds, folderExists: existsSync(holdsDir) }).toStrictEqual({ holds: {}, folderExists: false });
	});

	test('skips a corrupt hold file rather than losing the rest', async () => {
		const { cwd } = setupGateHoldsFolder({
			planted: {
				'lo-118.json': JSON.stringify(buildGateHold({ runId: 'run-a' })),
				'lo-119.json': 'half a wri',
			},
		});

		const holds = await readGateHolds({ cwd });

		// one interrupted write must not hide every other hold on the machine: the
		// tickets those holds block would all be picked up again by the next drain
		expect(holds).toStrictEqual({ 'lo-118': buildGateHold({ runId: 'run-a' }) });
	});

	test('ignores an entry that is not a readable hold file', async () => {
		const { cwd } = setupGateHoldsFolder({
			planted: {
				'lo-118.json': JSON.stringify(buildGateHold({ runId: 'run-a' })),
				'README.md': 'a note somebody dropped in the folder',
			},
			plantedFolders: ['lo-120.json'],
		});

		const holds = await readGateHolds({ cwd });

		// neither a neighbouring file that is not a hold nor a directory wearing the
		// hold suffix may fail the read: every other hold on the machine is refusing
		// a ticket, and losing them all would send each of those tickets to the next drain
		expect(holds).toStrictEqual({ 'lo-118': buildGateHold({ runId: 'run-a' }) });
	});
});
