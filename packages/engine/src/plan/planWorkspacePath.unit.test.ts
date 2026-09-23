import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { planWorkspaceDir, planWorkspacePath } from '#src/plan/index.ts';

/**
 * A directory with no repository above it, so the absolute answer is rooted at
 * the directory itself and relativising it leaves exactly the segments the
 * repo-relative spelling has to name.
 */
const setupLooseDirectory = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-workspace-path-'));

	/** The folder `planWorkspaceDir` resolves, spelled the way a manifest records it. */
	const resolvedSpellingOf = async ({ name }: { name: string }) =>
		relative(cwd, await planWorkspaceDir({ cwd, name }))
			.split(sep)
			.join('/');

	return { resolvedSpellingOf };
};

describe('planWorkspacePath', () => {
	test('planWorkspacePath: the repo-relative spelling names the same folder planWorkspaceDir resolves', async () => {
		const { resolvedSpellingOf } = setupLooseDirectory();
		const resolved = {
			address: await resolvedSpellingOf({ name: 'lo-155-ticket-scoped-state/001-ticket-folder' }),
			bare: await resolvedSpellingOf({ name: 'rate-limit-banner' }),
		};

		const written = {
			address: planWorkspacePath({ name: 'lo-155-ticket-scoped-state/001-ticket-folder' }),
			bare: planWorkspacePath({ name: 'rate-limit-banner' }),
		};

		expect(written).toStrictEqual({
			address: '.lightsout/work-orders/lo-155-ticket-scoped-state/plans/001-ticket-folder',
			bare: '.lightsout/work-orders/rate-limit-banner/plans',
		});
		expect(resolved).toStrictEqual(written);
	});
});
