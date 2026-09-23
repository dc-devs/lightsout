import { describe, expect, test } from '@jest/globals';
import { WorkOrderPlan } from '#src/contracts/index.ts';

const setupMarkerPlan = ({ publishedMarker }: { publishedMarker: string }) => {
	const markerPlan = {
		id: '001-search-basics',
		title: 'Search basics',
		progress: 'ready',
		createdAt: '2026-01-01T00:00:00.000Z',
		publishedMarker,
	};

	return { markerPlan };
};

const setupPlan = () => {
	const plan = {
		id: '001-search-basics',
		title: 'Search basics',
		progress: 'ready',
		createdAt: '2026-01-01T00:00:00.000Z',
	};

	return { plan };
};

const setupHashedPlans = ({ sha256 }: { sha256: string }) => {
	const { plan } = setupPlan();

	const snapshotPlan = {
		...plan,
		implementation: {
			runId: 'run-20260102-0900-abcdef',
			startedAt: '2026-01-02T09:00:00.000Z',
			startCommit: '9c4e2f7a1b3d5e6f8091a2b3c4d5e6f708192a3b',
			snapshot: [{ name: 'plan.md', sha256 }],
		},
	};
	const markerPlan = { ...plan, publishedMarker: sha256 };

	return { snapshotPlan, markerPlan };
};

const setupExclusionPlans = () => {
	const { plan } = setupPlan();
	const exclusion = {
		at: '2026-01-03T12:00:00.000Z',
		reason: 'switched to single-plan mode',
		implementationRemoved: false,
	};

	const excludedPlan = { ...plan, exclusion };
	const emptyReasonPlan = { ...plan, exclusion: { ...exclusion, reason: '' } };
	const noRemovalFlagPlan = {
		...plan,
		exclusion: { at: exclusion.at, reason: exclusion.reason },
	};
	const excludedProgressPlan = { ...plan, progress: 'excluded' };

	return { excludedPlan, emptyReasonPlan, noRemovalFlagPlan, excludedProgressPlan };
};

describe('WorkOrderPlan', () => {
	test('WorkOrderPlan: refuses a marker that is not a 64-character lowercase hex digest', () => {
		const accepted = setupMarkerPlan({
			publishedMarker: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
		});
		const uppercase = setupMarkerPlan({
			publishedMarker: '9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08',
		});
		const tooShort = setupMarkerPlan({
			publishedMarker: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0',
		});

		const parsedAccepted = WorkOrderPlan.safeParse(accepted.markerPlan);
		const parsedUppercase = WorkOrderPlan.safeParse(uppercase.markerPlan);
		const parsedTooShort = WorkOrderPlan.safeParse(tooShort.markerPlan);

		expect(parsedAccepted.success).toBe(true);
		expect(parsedAccepted.data).toStrictEqual({
			id: '001-search-basics',
			title: 'Search basics',
			progress: 'ready',
			createdAt: '2026-01-01T00:00:00.000Z',
			publishedMarker: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
		});
		expect(parsedUppercase.success).toBe(false);
		expect(parsedTooShort.success).toBe(false);
	});

	test('accepts a plan with only its required fields and adds no optional key', () => {
		const { plan } = setupPlan();

		const parsed = WorkOrderPlan.safeParse(plan);

		expect(parsed.success).toBe(true);
		expect(parsed.data).toStrictEqual({
			id: '001-search-basics',
			title: 'Search basics',
			progress: 'ready',
			createdAt: '2026-01-01T00:00:00.000Z',
		});
		expect(parsed.data).not.toHaveProperty('implementation');
		expect(parsed.data).not.toHaveProperty('publishedMarker');
		expect(parsed.data).not.toHaveProperty('exclusion');
	});

	test('refuses a snapshot hash or published marker that is not a 64-character lowercase hex digest', () => {
		const digest = setupHashedPlans({
			sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
		});
		const uppercase = setupHashedPlans({
			sha256: '9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08',
		});
		const tooShort = setupHashedPlans({
			sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0',
		});
		const notHex = setupHashedPlans({
			sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0g',
		});

		const acceptedSnapshot = WorkOrderPlan.safeParse(digest.snapshotPlan);
		const acceptedMarker = WorkOrderPlan.safeParse(digest.markerPlan);
		const uppercaseSnapshot = WorkOrderPlan.safeParse(uppercase.snapshotPlan);
		const uppercaseMarker = WorkOrderPlan.safeParse(uppercase.markerPlan);
		const shortSnapshot = WorkOrderPlan.safeParse(tooShort.snapshotPlan);
		const shortMarker = WorkOrderPlan.safeParse(tooShort.markerPlan);
		const notHexSnapshot = WorkOrderPlan.safeParse(notHex.snapshotPlan);
		const notHexMarker = WorkOrderPlan.safeParse(notHex.markerPlan);

		expect(acceptedSnapshot.success).toBe(true);
		expect(acceptedSnapshot.data).toStrictEqual(digest.snapshotPlan);
		expect(acceptedMarker.success).toBe(true);
		expect(acceptedMarker.data).toStrictEqual(digest.markerPlan);
		expect(uppercaseSnapshot.success).toBe(false);
		expect(uppercaseMarker.success).toBe(false);
		expect(shortSnapshot.success).toBe(false);
		expect(shortMarker.success).toBe(false);
		expect(notHexSnapshot.success).toBe(false);
		expect(notHexMarker.success).toBe(false);
	});

	test('refuses an exclusion without a reason or removal flag and refuses excluded as a progress', () => {
		const { excludedPlan, emptyReasonPlan, noRemovalFlagPlan, excludedProgressPlan } = setupExclusionPlans();

		const accepted = WorkOrderPlan.safeParse(excludedPlan);
		const emptyReason = WorkOrderPlan.safeParse(emptyReasonPlan);
		const noRemovalFlag = WorkOrderPlan.safeParse(noRemovalFlagPlan);
		const excludedProgress = WorkOrderPlan.safeParse(excludedProgressPlan);

		expect(accepted.success).toBe(true);
		expect(accepted.data).toStrictEqual(excludedPlan);
		expect(emptyReason.success).toBe(false);
		expect(noRemovalFlag.success).toBe(false);
		expect(excludedProgress.success).toBe(false);
	});
});
