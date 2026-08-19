import { expect, describe, test } from '@jest/globals';
import { setupWorkspace } from './setupWorkspace';

const setupConfig = ({ name = 'demo' }: { name?: string } = {}) => {
	return { name };
};

// The subject of this file IS a setup factory: calling it is the act, not
// arrangement, so one arrangement factory beside it is still one setup.
describe('setupWorkspace', () => {
	test('names the workspace after its config', () => {
		const config = setupConfig({ name: 'alpha' });

		const workspace = setupWorkspace({ config });

		expect(workspace.name).toBe('alpha');
	});
});
