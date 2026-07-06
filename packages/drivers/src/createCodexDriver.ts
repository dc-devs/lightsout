import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnCollect } from './common/utils/spawnCollect';
import type { Driver } from './common/types/Driver';

/** Same error-path-only heuristic as the claude-code driver. */
const rateLimitPattern = /usage limit|rate limit|limit reached|quota/i;

/**
 * Map the engine's permission modes onto codex sandbox policies. Codex exec
 * never prompts, so the sandbox flag is the whole permission story.
 */
const sandboxArgs = ({ permissionMode }: { permissionMode?: string }) => {
	if (permissionMode === 'plan') {
		return ['--sandbox', 'read-only'];
	}

	if (permissionMode === 'bypassPermissions') {
		return ['--dangerously-bypass-approvals-and-sandbox'];
	}

	return ['--sandbox', 'workspace-write'];
};

/**
 * Driver for the Codex CLI in non-interactive mode (`codex exec`).
 *
 * Spawns the user's own installed, logged-in `codex` binary — auth and
 * billing ride the user's existing ChatGPT plan, and the engine never sees a
 * credential. Codex has no system-prompt channel, so the role instructions
 * ride at the top of the task text. The final message is read from
 * `--output-last-message` rather than parsed out of the event stream. Flag
 * surface verified against codex-cli 0.128.0.
 */
export const createCodexDriver = () => {
	const driver: Driver = {
		name: 'codex',
		invoke: async (invocation) => {
			// allowedCommands is deliberately unused: codex's workspace-write
			// sandbox already permits commands, so the grant that binds is the
			// prompt-level list the engine injects into the invocation.
			const { prompt, systemPrompt, model, permissionMode, cwd, timeoutMs } = invocation;

			const outDir = await mkdtemp(join(tmpdir(), 'lightsout-codex-'));
			const outFile = join(outDir, 'last-message.txt');

			const args = [
				'exec',
				'--skip-git-repo-check',
				'--color',
				'never',
				'--output-last-message',
				outFile,
				...sandboxArgs({ permissionMode }),
			];

			if (model) {
				args.push('--model', model);
			}

			const fullPrompt = systemPrompt ? `# Role instructions\n\n${systemPrompt}\n\n# Task\n\n${prompt}` : prompt;

			try {
				const { exitCode, stdout, stderr } = await spawnCollect({
					command: 'codex',
					args,
					cwd,
					stdinText: fullPrompt,
					timeoutMs,
				});

				const text = await readFile(outFile, 'utf8').catch(() => '');
				const errored = exitCode !== 0 || text === '';

				return {
					text: text || stdout || stderr,
					exitCode,
					rateLimited: errored && rateLimitPattern.test(`${stdout}\n${stderr}`),
				};
			} finally {
				await rm(outDir, { recursive: true, force: true });
			}
		},
	};

	return driver;
};
