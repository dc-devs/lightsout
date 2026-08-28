import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ShipResult } from '#src/contracts/index.ts';
import { writeShipResult } from '#src/ship/writeShipResult.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/** A repo with nowhere to write yet — the directory is the writer's job to create. */
const setupResultWrite = async ({ branch }: { branch?: string } = {}) => {
	const cwd = await freshCwd();
	const result = ShipResult.parse({ status: 'blocked', reason: 'checks-failed', detail: 'unit finished red', failingChecks: ['unit'], branch });

	return { cwd, result };
};

describe('writeShipResult', () => {
	test('files the result under the branch it describes, creating the directory on the way', async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'lo-60-ship' });

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'ship', 'lo-60-ship.json'));
		expect(JSON.parse(await readFile(resultPath, 'utf8'))).toStrictEqual(result);
	});

	test('slugs a branch carrying a slash, so a feature branch never writes into a directory of its own', async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'feature/lo-60' });

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'ship', 'feature-lo-60.json'));
	});

	test('a result with no branch is filed under `unknown`, so even a run that never learned one leaves a record', async () => {
		const { cwd, result } = await setupResultWrite();

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'ship', 'unknown.json'));
	});

	test('leaves no temp file behind, because a tracker skill reading the directory would find two answers', async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'lo-60-ship' });

		const resultPath = await writeShipResult({ cwd, result });

		await expect(readFile(`${resultPath}.tmp`, 'utf8')).rejects.toThrow();
	});
});
