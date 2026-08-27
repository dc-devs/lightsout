import { expect, test } from '@jest/globals';
import * as library from '#src/index.ts';

/**
 * The engine's library entry is a contract with its consumers, not an
 * implementation detail: a package importing `@lightsout/engine` gets exactly
 * this surface, and an export quietly dropped from the barrel is a break that
 * nothing else in this suite would notice until a consumer's build failed.
 *
 * This is the one barrel a dedicated test belongs on. What each of these things
 * DOES is proven by its own file's tests — nothing here reaches into one.
 */
test('the library entry exposes the readers, the run-state predicates, and the shapes their results are validated against', () => {
	expect(Object.keys(library).sort()).toStrictEqual([
		'AgentInvocation',
		'AgentUsage',
		'BatchReport',
		'FixtureSide',
		'FrictionRecord',
		'GateEvidence',
		'GateResult',
		'PhaseReport',
		'PlanDocument',
		'PlanDocumentKind',
		'RunBurnDown',
		'RunBurnDownBatch',
		'RunBurnDownBatchOutcome',
		'RunListing',
		'RunManifest',
		'RunNotFoundError',
		'RunStatus',
		'RunStepView',
		'RunUsage',
		'RunView',
		'StandardsFinding',
		'StandardsPackBundle',
		'StandardsPackDocumentView',
		'StandardsPackFixture',
		'StandardsPackListing',
		'StandardsPackNotFoundError',
		'StandardsPackRuleListing',
		'StandardsPackRuleNotFoundError',
		'StandardsPackRuleView',
		'StandardsPackView',
		'StandardsRuleView',
		'StandardsSeverity',
		'StandardsSnapshot',
		'StandardsTrendPoint',
		'StandardsView',
		'StepRecord',
		'WorkReport',
		'WritersReport',
		'buildStandardsHealth',
		'getPlanDocument',
		'getRunView',
		'getStandardsPackBundle',
		'getStandardsPackRuleView',
		'getStandardsPackView',
		'getStandardsView',
		'isRunLive',
		'isRunResumable',
		'listRunIds',
		'listRuns',
		'listStandardsPacks',
		'listStandardsRules',
		'listStandardsSnapshots',
		'readFriction',
		'readRunManifest',
		'summarizeRun',
		'toStandardsPackListing',
		'toStandardsPackRuleView',
		'toStandardsPackView',
	]);
});

test('every name arrived as the kind of value a consumer can use, rather than erasing to undefined', () => {
	// The failure this catches is a name that survives the list above and is
	// unusable anyway: a schema exported as a type erases at run time, and a
	// const object exported as a type takes its members with it. Each kind is
	// asked for the one thing that proves it crossed the boundary intact.
	const schemas = [
		library.AgentInvocation,
		library.AgentUsage,
		library.BatchReport,
		library.FrictionRecord,
		library.GateEvidence,
		library.GateResult,
		library.PhaseReport,
		library.PlanDocument,
		library.RunListing,
		library.RunManifest,
		library.RunStepView,
		library.RunUsage,
		library.RunView,
		library.StandardsFinding,
		library.StandardsPackBundle,
		library.StandardsPackDocumentView,
		library.StandardsPackFixture,
		library.StandardsPackListing,
		library.StandardsPackRuleListing,
		library.StandardsPackRuleView,
		library.StandardsPackView,
		library.StandardsRuleView,
		library.StandardsSnapshot,
		library.StandardsTrendPoint,
		library.StandardsView,
		library.StepRecord,
		library.WorkReport,
		library.WritersReport,
	];
	const readers = [
		library.buildStandardsHealth,
		library.getPlanDocument,
		library.getRunView,
		library.getStandardsPackBundle,
		library.getStandardsPackRuleView,
		library.getStandardsPackView,
		library.getStandardsView,
		library.isRunLive,
		library.isRunResumable,
		library.listRunIds,
		library.listRuns,
		library.listStandardsPacks,
		library.listStandardsRules,
		library.listStandardsSnapshots,
		library.readFriction,
		library.readRunManifest,
		library.summarizeRun,
		library.toStandardsPackListing,
		library.toStandardsPackRuleView,
		library.toStandardsPackView,
	];
	const constObjects = [library.FixtureSide, library.PlanDocumentKind, library.RunStatus, library.StandardsSeverity];

	expect({
		schemas: schemas.every((schema) => typeof schema?.safeParse === 'function'),
		readers: readers.every((reader) => typeof reader === 'function'),
		constObjects: constObjects.every((entry) => Object.values(entry ?? {}).length > 0),
		// the errors a consumer catches by identity rather than by message
		errors: [
			new library.RunNotFoundError('x'),
			new library.StandardsPackNotFoundError({ name: 'acme' }),
			new library.StandardsPackRuleNotFoundError({ name: 'acme', rule: 'house-loose-file' }),
		].every((error) => error instanceof Error),
	}).toStrictEqual({ schemas: true, readers: true, constObjects: true, errors: true });
});
