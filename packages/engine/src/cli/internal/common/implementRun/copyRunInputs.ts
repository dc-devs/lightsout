import { cp, mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { planNameFromPath } from '#src/plan/planNameFromPath.ts';

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

/**
 * One input made readable from the workspace, answered as the path to read it
 * back at from there.
 *
 * An input naming a plan is answered where it already is: a plan folder lives in
 * the main checkout whichever checkout a run works in, so copying it into the
 * workspace would copy a directory onto itself. It is still answered
 * repo-relative, which is what an absolute `--plan` is normalised to and what
 * the run manifest records. Anything else is a loose file and is still copied in.
 */
const copyOneInput = async ({ sourceCwd, workspace, inputPath }: { sourceCwd: string; workspace: string; inputPath: string }) => {
	const name = await planNameFromPath({ cwd: sourceCwd, planPath: inputPath });

	return name === undefined ? copyLooseInput({ sourceCwd, workspace, inputPath }) : relative(sourceCwd, resolve(sourceCwd, inputPath));
};

/**
 * Copy a run's loose inputs into the workspace and answer where every input is
 * to be read from there.
 *
 * A loose input is copied, so the run is independent of later edits to it. A
 * plan folder is not: it lives in the main checkout whichever checkout the run
 * works in, which is the one input a run shares with the checkout and the price
 * of that folder surviving a tree that gets removed.
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
