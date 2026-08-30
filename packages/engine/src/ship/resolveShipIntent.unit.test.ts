import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveShipIntent } from '#src/ship/index.ts';

/** A config whose only interesting part is its `ship` block, or the absence of one. */
const configOf = ({ ship }: { ship?: Record<string, unknown> } = {}) =>
	LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ...(ship === undefined ? {} : { ship }) });

describe('resolveShipIntent', () => {
	test('nobody asked, so nothing ships', () => {
		const intent = resolveShipIntent({ config: configOf(), shipFlag: false, noShipFlag: false, env: {} });

		expect(intent).toEqual({ contradictory: false, willShip: false, settings: expect.objectContaining({ afterImplement: false }) });
	});

	test('--ship alone is enough', () => {
		expect(resolveShipIntent({ config: configOf(), shipFlag: true, noShipFlag: false, env: {} }).willShip).toBe(true);
	});

	test('the config can ask for it without any flag being typed', () => {
		expect(resolveShipIntent({ config: configOf({ ship: { 'after-implement': true } }), shipFlag: false, noShipFlag: false, env: {} }).willShip).toBe(true);
	});

	test('--no-ship beats the config, so a repo with after-implement on can still end a run unshipped', () => {
		const intent = resolveShipIntent({ config: configOf({ ship: { 'after-implement': true } }), shipFlag: false, noShipFlag: true, env: {} });

		expect(intent).toEqual(expect.objectContaining({ contradictory: false, willShip: false }));
	});

	test('LIGHTSOUT_NO_SHIP wins silently over both the flag and the config — a queue worker never ships its own branch', () => {
		const config = configOf({ ship: { 'after-implement': true } });

		expect(resolveShipIntent({ config, shipFlag: true, noShipFlag: false, env: { LIGHTSOUT_NO_SHIP: '1' } }).willShip).toBe(false);
	});

	test('an empty LIGHTSOUT_NO_SHIP is not a suppression — only a value set to something is', () => {
		expect(resolveShipIntent({ config: configOf(), shipFlag: true, noShipFlag: false, env: { LIGHTSOUT_NO_SHIP: '' } }).willShip).toBe(true);
	});

	test('both flags together are reported contradictory, and nothing ships on a contradiction', () => {
		const intent = resolveShipIntent({ config: configOf({ ship: { 'after-implement': true } }), shipFlag: true, noShipFlag: true, env: {} });

		expect(intent).toEqual(expect.objectContaining({ contradictory: true, willShip: false }));
	});

	test('an unusable ticket pattern leaves settings undefined while --ship still records the intent', () => {
		const intent = resolveShipIntent({ config: configOf({ ship: { 'ticket-pattern': '^lo-\\d+' } }), shipFlag: true, noShipFlag: false, env: {} });

		// the run INTENDED to ship, so the table shows the row; the exit path is
		// where the unusable pattern becomes a loud usage error
		expect(intent).toStrictEqual({ contradictory: false, willShip: true, settings: undefined });
	});

	test('an unusable ticket pattern nobody asked to ship against still ships nothing', () => {
		const intent = resolveShipIntent({ config: configOf({ ship: { 'ticket-pattern': '^lo-\\d+' } }), shipFlag: false, noShipFlag: false, env: {} });

		expect(intent).toStrictEqual({ contradictory: false, willShip: false, settings: undefined });
	});
});
