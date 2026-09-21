import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeEmptyDecisions } from '#tests/helpers/writeEmptyDecisions.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

/**
 * A repo whose plan folder holds a single-file deliverable, or — with `drafted`
 * false — no plan folder at all, which is what a pass opened against a plan that
 * was never drafted finds.
 */
const setupDetectionPass = ({ drafted = true }: { drafted?: boolean } = {}) => {
	const cwd = setupConsumerRepo();
	const name = 'lo-150-planning-observability';
	const dir = drafted ? writePlanDeliverable({ cwd, name, body: '# The plan\n' }) : planWorkspaceFolder({ cwd: cwd, name: name });

	return { cwd, name, dir };
};

/**
 * A primary checkout holding the drafted plan, with a linked worktree cut from
 * it — the shape a dedup or grade pass runs in once plan data stays in the main
 * checkout whichever tree the command was launched from.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const name = 'lo-150-planning-observability';
	const worktree = join(cwd, '.worktrees', name);
	// git answers with a fully resolved path, so the folder is spelled the way the
	// helper will answer it — macOS's symlinked temp directory otherwise makes an
	// equal pair look unequal.
	const dir = planWorkspaceFolder({ cwd: realpathSync(cwd), name });

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), '# The plan the primary holds\n', 'utf8');
	writeEmptyDecisions({ dir, name });
	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { name, dir, worktree };
};

describe('getPlanDetectionPass', () => {
	test('gathers the deliverable, the paths the detectors read and the merged decision record', async () => {
		const { cwd, name, dir } = setupDetectionPass();

		const pass = await getPlanDetectionPass({ cwd, name });

		expect({
			workspaceDir: pass.workspaceDir,
			files: pass.files,
			planPaths: pass.planPaths,
			decisions: pass.decisions,
			error: pass.error,
		}).toStrictEqual({
			workspaceDir: dir,
			files: [{ path: join(dir, 'plan.md'), text: '# The plan\n' }],
			planPaths: [join(dir, 'plan.md')],
			decisions: { planName: name, decisions: [] },
			error: undefined,
		});
	});

	test('creates the plan workspace before resolving inputs, so a pass that finds no plan still has somewhere to report from', async () => {
		const { cwd, name, dir } = setupDetectionPass({ drafted: false });

		const pass = await getPlanDetectionPass({ cwd, name });

		// the directory is made first and the resolve fails after it, which is the
		// order that lets the failure be written into the plan's own folder
		expect({ created: existsSync(dir), workspaceDir: pass.workspaceDir, files: pass.files }).toStrictEqual({
			created: true,
			workspaceDir: dir,
			files: [],
		});
		expect(pass.error).toEqual(expect.stringContaining(`no plan found for '${name}'`));
	});

	test("a pass run from a linked worktree works the primary checkout's plan folder", async () => {
		const { name, dir, worktree } = setupLinkedWorktree();

		const pass = await getPlanDetectionPass({ cwd: worktree, name });

		// resolved against the worktree, the pass would make an empty plans
		// directory inside a tree that gets removed and report the plan as missing
		expect({
			files: pass.files,
			error: pass.error,
			worktreeHasPlans: existsSync(join(worktree, '.lightsout')),
		}).toStrictEqual({
			files: [{ path: join(dir, 'plan.md'), text: '# The plan the primary holds\n' }],
			error: undefined,
			worktreeHasPlans: false,
		});
	});
});
