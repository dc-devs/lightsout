import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { resolveShipIntent } from '#src/ship/resolveShipIntent.ts';

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

	test('a satisfied ship request ships without --ship or after-implement', () => {
		const intent = resolveShipIntent({
			config: configOf({ ship: { 'after-implement': false } }),
			shipFlag: false,
			noShipFlag: false,
			env: {},
			shipRequest: { blocker: undefined },
		});

		// the ticket record already said to ship this set of plans, so the run
		// that finishes it needs no flag and no repository default
		expect(intent).toEqual(expect.objectContaining({ contradictory: false, willShip: true, shipRequestBlocker: undefined }));
	});

	test('an unsatisfied ship request beats both --ship and after-implement and says why', () => {
		const blocker = 'The ticket has no ship request, so this run does not ship it.';

		const intent = resolveShipIntent({
			config: configOf({ ship: { 'after-implement': true } }),
			shipFlag: true,
			noShipFlag: false,
			env: {},
			shipRequest: { blocker },
		});

		expect(intent).toEqual(expect.objectContaining({ contradictory: false, willShip: false, shipRequestBlocker: blocker }));
	});

	test('--no-ship and LIGHTSOUT_NO_SHIP still stop a satisfied ship request, with no ship-request sentence', () => {
		const config = configOf({ ship: { 'after-implement': true } });

		const byFlag = resolveShipIntent({ config, shipFlag: false, noShipFlag: true, env: {}, shipRequest: { blocker: undefined } });
		const byEnv = resolveShipIntent({ config, shipFlag: false, noShipFlag: false, env: { LIGHTSOUT_NO_SHIP: '1' }, shipRequest: { blocker: undefined } });

		// a suppressed run is not a run the ticket held back, so it says nothing
		// about the ship request
		expect(byFlag).toEqual(expect.objectContaining({ willShip: false, shipRequestBlocker: undefined }));
		expect(byEnv).toEqual(expect.objectContaining({ willShip: false, shipRequestBlocker: undefined }));
	});
});
