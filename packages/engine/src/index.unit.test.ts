import { expect, test } from '@jest/globals';
import * as library from '#src/index.ts';

/**
 * The engine's library entry is a contract with its consumers, not an
 * implementation detail: a package importing `@lightsout/engine` gets exactly
 * this surface, and an export quietly dropped from the barrel is a break that
 * nothing else in this suite would notice until a consumer's build failed.
 */
test('the library entry exposes the readers, the run-state predicates, and the shapes their results are validated against', () => {
	expect(Object.keys(library).sort()).toStrictEqual([
		'AgentInvocation',
		'AgentUsage',
		'BatchReport',
		'FrictionRecord',
		'GateEvidence',
		'GateResult',
		'PhaseReport',
		'PlanDocument',
		'PlanDocumentKind',
		'RunListing',
		'RunManifest',
		'RunNotFoundError',
		'RunStatus',
		'RunStepView',
		'RunUsage',
		'RunView',
		'StandardsFinding',
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
		'getStandardsView',
		'isRunLive',
		'isRunResumable',
		'listRunIds',
		'listRuns',
		'listStandardsRules',
		'listStandardsSnapshots',
		'readFriction',
		'readRunManifest',
		'summarizeRun',
	]);
});

test('every exported schema parses, so a consumer validating at its own boundary gets a schema rather than a shape', () => {
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
		library.StandardsRuleView,
		library.StandardsSnapshot,
		library.StandardsTrendPoint,
		library.StandardsView,
		library.StepRecord,
		library.WorkReport,
		library.WritersReport,
	];

	// nothing here is a bare type that erased to undefined at run time
	expect(schemas.every((schema) => typeof schema.safeParse === 'function')).toBe(true);
	// and every one of them refuses a value of the wrong shape rather than waving it through
	expect(schemas.every((schema) => !schema.safeParse('not a record').success)).toBe(true);
});

test('the const objects travel as values, so a consumer never retypes a status or a kind literal', () => {
	expect(library.RunStatus.PausedRateLimit).toBe('paused-rate-limit');
	expect(library.PlanDocumentKind.CoverageWorklist).toBe('coverageWorklist');
	expect(library.StandardsSeverity.Blocking).toBe('blocking');
});

test('the readers and predicates arrive as callable functions', () => {
	const callables = [
		library.buildStandardsHealth,
		library.getPlanDocument,
		library.getRunView,
		library.getStandardsView,
		library.isRunLive,
		library.isRunResumable,
		library.listRunIds,
		library.listRuns,
		library.listStandardsRules,
		library.listStandardsSnapshots,
		library.readFriction,
		library.readRunManifest,
		library.summarizeRun,
	];

	expect(callables.every((entry) => typeof entry === 'function')).toBe(true);
	// the error a consumer catches by identity rather than by message
	expect(new library.RunNotFoundError('x')).toBeInstanceOf(Error);
});
