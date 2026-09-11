import { cp, mkdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { planNameFromPath, planWorkspaceDir } from '#src/plan/index.ts';

interface Params {
	/** The checkout the command was launched from. */
	sourceCwd: string;
	/** The workspace the run works in. Equal to `sourceCwd` when isolation is off, where nothing is copied. */
	workspace: string;
	/** `--plan` exactly as the user typed it. */
	planPath?: string;
	/** `--ticket` exactly as the user typed it. */
	ticketPath?: string;
}

/**
 * The whole plan folder, copied to the same place under the workspace, so an
 * `overview.md`, its phase files and the plan's working files all arrive
 * together and overview-and-phase resolution keeps working untouched.
 *
 * That place is already inside the workspace's gitignored lightsout state
 * directory. The answered path is the input's own tail rebuilt
 * workspace-relative, which is what normalises an absolute `--plan` onto the
 * copy.
 *
 * A workspace already holding a folder of that name keeps it outright — local
 * disk wins, the rule `ensurePlanWorkspace` states. A run continuing in the tree
 * planning established would otherwise overwrite the graded plan and its
 * grading memory with whatever was left in the launching checkout. Anything
 * else standing at that path is no plan folder, and the copy is still attempted
 * so its failure is reported.
 */
const copyPlanFolder = async ({ sourceCwd, workspace, name, inputPath }: { sourceCwd: string; workspace: string; name: string; inputPath: string }) => {
	const destination = planWorkspaceDir({ cwd: workspace, name });
	const held = await stat(destination).then(
		(found) => found.isDirectory(),
		() => false,
	);

	if (!held) {
		await cp(planWorkspaceDir({ cwd: sourceCwd, name }), destination, { recursive: true });
	}

	return relative(sourceCwd, resolve(sourceCwd, inputPath));
};

/**
 * A loose plan file or a direct run's ticket file, copied to one file under an
 * `inputs` folder inside the workspace's gitignored lightsout state directory.
 *
 * Whether the original sat inside `sourceCwd` or outside it makes no
 * difference: the destination is the same, so no input can land on a tracked
 * path and a run ending in `git add -A` cannot stage the user's own input into
 * its commit.
 */
const copyLooseInput = async ({ sourceCwd, workspace, inputPath }: { sourceCwd: string; workspace: string; inputPath: string }) => {
	const source = resolve(sourceCwd, inputPath);
	const destination = join(workspace, '.lightsout', 'inputs', basename(source));

	await mkdir(dirname(destination), { recursive: true });
	await cp(source, destination);

	return relative(workspace, destination);
};

/** One input copied into the workspace, answered as the path to read it back at from there. */
const copyOneInput = ({ sourceCwd, workspace, inputPath }: { sourceCwd: string; workspace: string; inputPath: string }) => {
	const name = planNameFromPath({ cwd: sourceCwd, planPath: inputPath });

	return name === undefined ? copyLooseInput({ sourceCwd, workspace, inputPath }) : copyPlanFolder({ sourceCwd, workspace, name, inputPath });
};

/**
 * Copy a run's inputs into the workspace and answer where they are to be read
 * from there, so the run is independent of later edits to the source files.
 *
 * Every copy lands inside the workspace's own gitignored lightsout state
 * directory, and nowhere else. A direct run ends in `git add -A`, which stages
 * every untracked file in the tree, so a copy written to an ordinary
 * repository-relative path would be swept into the ticket's own commit and
 * reach its pull request. Keeping every copy inside the ignored directory makes
 * that impossible by construction rather than by teaching the shared commit
 * step a new exception.
 *
 * Source files are only read: nothing under `sourceCwd` is written, moved or
 * deleted, which is what leaves the user's uncommitted edits beside the plan
 * alone. A run that is not isolated copies nothing — its workspace already
 * holds the inputs — and answers the paths it was handed.
 *
 * @returns where each given input is read from in the workspace, or the one sentence saying why it is not there
 */
export const copyRunInputs = async ({
	sourceCwd,
	workspace,
	planPath,
	ticketPath,
}: Params): Promise<{ planPath?: string; ticketPath?: string } | { error: string }> => {
	if (resolve(workspace) === resolve(sourceCwd)) {
		return { planPath, ticketPath };
	}

	let copied: { planPath?: string; ticketPath?: string } | { error: string };

	try {
		copied = {
			planPath: planPath === undefined ? undefined : await copyOneInput({ sourceCwd, workspace, inputPath: planPath }),
			ticketPath: ticketPath === undefined ? undefined : await copyOneInput({ sourceCwd, workspace, inputPath: ticketPath }),
		};
	} catch (error) {
		copied = { error: `the run's inputs could not be copied into ${workspace}: ${messageOf({ error })}` };
	}

	return copied;
};
