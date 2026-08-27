import { describe, expect, jest, test } from '@jest/globals';
import { PlanWorkspaceNotFoundError, type PlanWorkspaceView } from '@lightsout/engine';
import { getPlanWorkspaceServerFn } from '#src/features/plans/serverFns/getPlanWorkspaceServerFn.ts';
import { buildPlanWorkspaceView } from '#tests/helpers/buildPlanWorkspaceView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `getPlanWorkspaceServerFn` runs
// and only the filesystem at the far end of the reader is stood in for.
const mockGetPlanWorkspace = jest.fn<(params: { name: string }) => Promise<PlanWorkspaceView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPlanWorkspace: (params: { name: string }) => mockGetPlanWorkspace(params) }),
}));
// -------------------------

const setupGetPlanWorkspaceServerFn = ({ rejection }: { rejection?: Error } = {}) => {
	const view = buildPlanWorkspaceView();

	if (rejection === undefined) {
		mockGetPlanWorkspace.mockResolvedValue(view);
	} else {
		mockGetPlanWorkspace.mockRejectedValue(rejection);
	}

	return { view };
};

describe('getPlanWorkspaceServerFn', () => {
	test('hands back the workspace the reader answered with, whole', async () => {
		const { view } = setupGetPlanWorkspaceServerFn();

		const answer = await getPlanWorkspaceServerFn({ data: { name: 'add-search' } });

		expect(answer).toStrictEqual(view);
	});

	test("turns a name no workspace answers to into the router's own not-found signal, since an error class cannot cross the wire", async () => {
		setupGetPlanWorkspaceServerFn({ rejection: new PlanWorkspaceNotFoundError({ name: 'never-planned' }) });

		await expect(getPlanWorkspaceServerFn({ data: { name: 'never-planned' } })).rejects.toStrictEqual({ isNotFound: true });
	});

	test('lets any other failure travel as itself, so a 404 only ever means the name was wrong', async () => {
		setupGetPlanWorkspaceServerFn({ rejection: new Error('EACCES: permission denied') });

		await expect(getPlanWorkspaceServerFn({ data: { name: 'add-search' } })).rejects.toThrow('EACCES: permission denied');
	});
});
