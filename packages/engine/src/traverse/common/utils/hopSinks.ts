import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	/** The run directory the hop's evidence files are written under. */
	runDir: string;
	hopNumber: number;
}

interface HopSinks {
	onEvent: (event: unknown) => void;
	onRejectedOutput: (params: { text: string; attempt: number }) => Promise<void>;
}

/**
 * The per-hop evidence sinks handed to a hop invocation: tee the agent's event
 * stream to `hop-<n>-stream.jsonl` and persist any contract-rejected final
 * message to `hop-<n>-rejected-<attempt>.txt`. Identical across the traverse
 * and debug loops.
 */
export const hopSinks = ({ runDir, hopNumber }: Params): HopSinks => ({
	onEvent: (event) => {
		void appendFile(join(runDir, `hop-${hopNumber}-stream.jsonl`), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
	},
	onRejectedOutput: async ({ text, attempt }) => {
		await writeFile(join(runDir, `hop-${hopNumber}-rejected-${attempt}.txt`), text, 'utf8').catch(() => undefined);
	},
});
