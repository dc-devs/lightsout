import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * lightsout voice, as a pi-family extension — omp and bare pi both load this
 * factory shape and these events.
 *
 * The plugin's Claude Code hook reads questions out of a finished transcript;
 * omp and pi hand the same moments to an extension live instead — `tool_call`
 * for the option picker the moment it appears, `turn_end` for a finished turn
 * that asked a labelled question. This file only adapts those events to the
 * engine's own `voice speak` command, which owns every decision: the
 * per-project on/off marker, the Mac-only gate, what counts as a question, and
 * the actual speech. Nothing is awaited and nothing is spoken when the engine
 * stays silent — an extension that failed loudly would break the session it
 * serves.
 */

// <plugin>/extensions/voice.ts → <plugin>/dist/cli.mjs, resolved from this
// file's own location so it survives however the plugin was installed.
const cliPath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'cli.mjs');

/** The events and context arrive in shapes the two forks type differently, so this extension reads them structurally and narrows itself. */
interface PiFamilyApi {
	on: (event: 'tool_call' | 'turn_end', handler: (event: unknown, context: unknown) => void | Promise<void>) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The session's working directory, which owns the voice on/off marker — the session cwd, wherever this fork keeps it. */
const cwdOf = (context: unknown): string => (isRecord(context) && typeof context.cwd === 'string' ? context.cwd : process.cwd());

/** Fire the engine's `voice speak` and let go: detached, unsupervised, never blocking the session on it. */
const speak = ({ cwd, kind, payload }: { cwd: string; kind: 'turn' | 'picker'; payload: string }) => {
	const child = spawn('node', [cliPath, 'voice', 'speak', kind], {
		cwd,
		stdio: ['pipe', 'ignore', 'ignore'],
		detached: true,
	});

	// A spawn failure with nobody listening is an uncaught exception, which for
	// a fire-and-forget extension means crashing the very session it serves.
	child.on('error', () => {});
	child.stdin?.on('error', () => {});
	child.stdin?.end(payload);
	child.unref();
};

export default function (pi: PiFamilyApi): void {
	pi.on('tool_call', (event, context) => {
		if (!isRecord(event) || event.toolName !== 'ask') {
			return;
		}

		speak({ cwd: cwdOf(context), kind: 'picker', payload: JSON.stringify(event.input ?? {}) });
	});

	pi.on('turn_end', (event, context) => {
		const content = isRecord(event) && isRecord(event.message) ? event.message.content : undefined;

		if (!Array.isArray(content)) {
			return;
		}

		speak({ cwd: cwdOf(context), kind: 'turn', payload: JSON.stringify(content) });
	});
}
