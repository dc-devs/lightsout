import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** PATH as it stood before any scenario put a fake harness in front of it. */
const realPath = process.env.PATH ?? '';

interface Params {
	/** The binary the driver under test spawns — `claude`, `pi`, `omp`. */
	binary: string;
	/** The flag the driver points at its system-prompt file, so the scenario can read back what the harness was handed. */
	systemPromptFlag: string;
	stdoutChunks?: string[];
	/** Pause between chunks, so a payload split across two reads is really read twice. */
	chunkDelay?: boolean;
	stderr?: string;
	exitCode?: number;
	/** Hang for this long instead of answering — the harness a timeout has to kill. */
	delaySeconds?: number;
	/** `false` exits before touching stdin — a harness that rejects its flags and bails. */
	readsStdin?: boolean;
}

/**
 * A fake harness binary at the front of PATH: it records the argv and stdin it
 * was handed, copies any system-prompt file it was pointed at (the real one is
 * deleted before the invocation returns), streams the scenario's stdout, and
 * exits with the scenario's code.
 *
 * The harness binary is the one unowned boundary in a driver test, so it is the
 * only thing stubbed — the driver under test is the real one, spawning a real
 * process. Putting PATH back afterwards is the test file's own business.
 */
export const fakeHarnessOnPath = async ({
	binary,
	systemPromptFlag,
	stdoutChunks = [],
	chunkDelay = false,
	stderr = '',
	exitCode = 0,
	delaySeconds = 0,
	readsStdin = true,
}: Params): Promise<{
	cwd: string;
	readArgv: () => Promise<string[]>;
	readStdin: () => Promise<string>;
	readSystemPromptCopy: () => Promise<string>;
}> => {
	const dir = await mkdtemp(join(tmpdir(), `lightsout-${binary}-driver-`));
	const binDir = join(dir, 'bin');
	const argvPath = join(dir, 'argv.txt');
	const stdinPath = join(dir, 'stdin.txt');
	const promptCopyPath = join(dir, 'system-prompt-copy.md');

	await mkdir(binDir);
	await writeFile(
		join(binDir, binary),
		[
			'#!/bin/sh',
			`printf '%s\\n' "$@" > '${argvPath}'`,
			"prev=''",
			'for arg in "$@"; do',
			`  if [ "$prev" = "${systemPromptFlag}" ]; then cp "$arg" '${promptCopyPath}'; fi`,
			'  prev="$arg"',
			'done',
			...(readsStdin ? [`cat > '${stdinPath}'`] : []),
			// `exec` so the hang IS this process rather than a child of it: a plain
			// `sleep` would survive the driver's SIGKILL, outlive the test as an
			// orphan, and keep the inherited stdout pipe open.
			...(delaySeconds > 0 ? [`exec sleep ${delaySeconds}`] : []),
			...stdoutChunks.flatMap((chunk, index) => [...(index > 0 && chunkDelay ? ['sleep 0.2'] : []), `printf '%s' '${chunk}'`]),
			`printf '%s' '${stderr}' >&2`,
			`exit ${exitCode}`,
		].join('\n'),
		'utf8',
	);
	await chmod(join(binDir, binary), 0o755);

	process.env.PATH = `${binDir}:${realPath}`;

	return {
		cwd: dir,
		readArgv: async () => (await readFile(argvPath, 'utf8')).split('\n').slice(0, -1),
		readStdin: async () => readFile(stdinPath, 'utf8'),
		readSystemPromptCopy: async () => readFile(promptCopyPath, 'utf8'),
	};
};
