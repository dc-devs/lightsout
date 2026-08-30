import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ShipBlockReason, ShipStatus } from '#src/contracts/index.ts';
import { readShipResult } from '#src/ship/index.ts';

const branch = 'lo-52-status';

/** A repo whose ship directory holds exactly the given file body for this branch. */
const setupShipResult = ({ body }: { body?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ship-result-'));

	mkdirSync(join(cwd, '.lightsout', 'ship'), { recursive: true });

	if (body !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'ship', `${branch}.json`), body, 'utf8');
	}

	return { cwd };
};

describe('readShipResult', () => {
	test('a shipped result reads back with everything the merge recorded', async () => {
		const { cwd } = setupShipResult({
			body: JSON.stringify({ status: ShipStatus.Shipped, branch, ticketRef: 'lo-52', prNumber: 41, mergeCommit: '0f1e2d3c', failingChecks: [] }),
		});

		const result = await readShipResult({ cwd, branch });

		expect(result).toEqual(expect.objectContaining({ status: ShipStatus.Shipped, branch, prNumber: 41 }));
	});

	test('a blocked result reads back too — a ship that ran and stopped is not a ship that never ran', async () => {
		const { cwd } = setupShipResult({
			body: JSON.stringify({ status: ShipStatus.Blocked, branch, reason: ShipBlockReason.ChecksFailed, failingChecks: ['unit'] }),
		});

		const result = await readShipResult({ cwd, branch });

		expect(result).toEqual(expect.objectContaining({ status: ShipStatus.Blocked, reason: ShipBlockReason.ChecksFailed, failingChecks: ['unit'] }));
	});

	test('no file at all reads as undefined — this branch has never been shipped', async () => {
		const { cwd } = setupShipResult();

		expect(await readShipResult({ cwd, branch })).toBeUndefined();
	});

	test('a file that is not JSON reads as undefined rather than throwing at a reader', async () => {
		const { cwd } = setupShipResult({ body: 'not json at all' });

		expect(await readShipResult({ cwd, branch })).toBeUndefined();
	});

	test('a file that parses but fails the contract reads as undefined', async () => {
		const { cwd } = setupShipResult({ body: JSON.stringify({ status: 'half-shipped' }) });

		expect(await readShipResult({ cwd, branch })).toBeUndefined();
	});

	test('a branch whose slugged name differs from the branch name is still found', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ship-result-'));

		mkdirSync(join(cwd, '.lightsout', 'ship'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'ship', 'feature-x.json'), JSON.stringify({ status: ShipStatus.Shipped, failingChecks: [] }), 'utf8');

		// results are filed under the slugged branch, and the reader slugs the same way
		expect(await readShipResult({ cwd, branch: 'feature/x' })).toEqual(expect.objectContaining({ status: ShipStatus.Shipped }));
	});
});
