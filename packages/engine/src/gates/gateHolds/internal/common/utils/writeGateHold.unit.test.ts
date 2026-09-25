import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readGateHolds } from '#src/gates/gateHolds/internal/common/utils/readGateHolds.ts';
import { writeGateHold } from '#src/gates/gateHolds/internal/common/utils/writeGateHold.ts';
import { buildGateHold } from '#tests/helpers/buildGateHold.ts';
import { setupGateHoldsFolder } from '#tests/helpers/setupGateHoldsFolder.ts';

describe('writeGateHold', () => {
	test("creates the holds directory and round-trips one ticket's hold", async () => {
		const { cwd, holdsDir } = setupGateHoldsFolder();
		const hold = buildGateHold({ runId: 'run-a' });

		await writeGateHold({ cwd, identifier: 'LO-119', hold });

		const holds = await readGateHolds({ cwd });

		// the first hold a repository ever takes meets a folder that is not there, and
		// losing that one to a missing directory would let the very ticket whose gates
		// timed out run again immediately
		expect({ holds, folderExists: existsSync(holdsDir) }).toStrictEqual({ holds: { 'lo-119': hold }, folderExists: true });
	});

	test("writes one ticket's hold without touching another's", async () => {
		const neighbour = JSON.stringify(buildGateHold({ runId: 'run-a' }));
		const { cwd, holdsDir } = setupGateHoldsFolder({ planted: { 'lo-118.json': neighbour } });

		await writeGateHold({ cwd, identifier: 'LO-119', hold: buildGateHold({ runId: 'run-b' }) });

		// one file per ticket is the whole isolation: a writer that rewrote the folder
		// as a document would drop the hold a worker took a moment earlier, which is
		// the lost write the local record exists to prevent
		expect({
			neighbourBytes: readFileSync(join(holdsDir, 'lo-118.json'), 'utf8'),
			written: existsSync(join(holdsDir, 'lo-119.json')),
		}).toStrictEqual({ neighbourBytes: neighbour, written: true });
	});
});
