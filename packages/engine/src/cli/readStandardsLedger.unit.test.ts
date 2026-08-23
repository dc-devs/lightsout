import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { readStandardsLedger } from '#src/cli/readStandardsLedger.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { StandardsRuleListing } from '#src/standardsCheck/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The listing itself is the standardsCheck module's to build and test; what
// this loader owns is the pairing — which config the listing is resolved from,
// and how a missing or unloadable half is treated.

interface ListStandardsRulesParams {
	cwd: string;
	config?: LightsoutConfig;
}

const mockListStandardsRules = jest.fn<(params: ListStandardsRulesParams) => Promise<StandardsRuleListing[]>>();

jest.mock('#src/standardsCheck/index.ts', () => ({ listStandardsRules: (params: ListStandardsRulesParams) => mockListStandardsRules(params) }));
// -------------------------

const listParams = () => mockListStandardsRules.mock.calls[0]?.[0];

describe('readStandardsLedger', () => {
	test("the repo's own config and path reach the listing, so the ledger is this repo's policy", async () => {
		const cwd = setupConsumerRepo({ git: false, config: { 'standards-checks': { clone: 'off' } } });

		mockListStandardsRules.mockResolvedValue([]);

		const { config } = await readStandardsLedger({ cwd });

		expect(listParams()?.config).toEqual(expect.objectContaining({ 'standards-checks': { clone: 'off' } }));
		// the repo path travels too: the packages a listing is built from are the
		// ones this repo asked for, resolved against it
		expect(listParams()?.cwd).toBe(cwd);
		// and the caller gets the same config back, so both halves read one answer
		expect(config).toEqual(expect.objectContaining({ 'standards-checks': { clone: 'off' } }));
	});

	test('a repo with no config still gets an answer — every rule at its default', async () => {
		const rules = [{ rule: 'multi-export' } as StandardsRuleListing];

		mockListStandardsRules.mockResolvedValue(rules);

		const ledger = await readStandardsLedger({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-ledger-')) });

		expect(listParams()?.config).toBeUndefined();
		expect(ledger).toStrictEqual({ config: undefined, rules });
	});

	test('a config that will not parse refuses, rather than listing the default pack as if it were the configured one', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ledger-'));

		writeFileSync(join(cwd, 'lightsout.config.json'), '{ "gates":');
		mockListStandardsRules.mockResolvedValue([]);

		// The config selects which standards packs are read. Answering from the
		// defaults when it cannot be parsed means listing one repo's rules and
		// calling them another's, with nothing in the output saying so.
		await expect(readStandardsLedger({ cwd })).rejects.toThrow(/is not valid JSON/);
	});

	test('a ledger that cannot be built refuses, carrying the loader’s own message', async () => {
		mockListStandardsRules.mockRejectedValue(new Error('standards pack "acme" could not be loaded'));

		await expect(readStandardsLedger({ cwd: '/repo' })).rejects.toThrow('standards pack "acme" could not be loaded');
	});
});
