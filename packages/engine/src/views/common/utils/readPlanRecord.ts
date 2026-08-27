import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import type { PlanWorkspaceFile } from '#src/contracts/index.ts';

/** JSON text against its contract, with every way it can fail said in one line rather than thrown. */
const parseRecord = <Shape>({ name, raw, schema }: { name: string; raw: string; schema: z.ZodType<Shape> }) => {
	let payload: unknown;

	try {
		payload = JSON.parse(raw);
	} catch {
		return { problem: `${name} is not valid JSON` };
	}

	const parsed = schema.safeParse(payload);

	// A failed parse always carries at least one issue, and the first is the one a
	// reader can act on.
	return parsed.success ? { value: parsed.data } : { problem: `${name} does not match its contract: ${parsed.error.issues[0].message}` };
};

interface Params<Shape> {
	cwd: string;
	/** The workspace file to read; a workspace without this record passes nothing and gets nothing back. */
	file?: PlanWorkspaceFile;
	/** Boundary schema the parsed JSON must satisfy. */
	schema: z.ZodType<Shape>;
}

/**
 * One of a plan workspace's JSON records, read the way a viewer needs it: the
 * value, or a line saying why the file would not read.
 *
 * The lenient sibling of `readPlanWorkspaceFile`, which throws instead. Throwing
 * is right for the pipeline, which must not proceed on half an answer, and wrong
 * for a page whose whole job is to show a half-finished workspace.
 */
export const readPlanRecord = async <Shape>({ cwd, file, schema }: Params<Shape>): Promise<{ value?: Shape; problem?: string }> => {
	let result: { value?: Shape; problem?: string } = {};

	if (file !== undefined) {
		const raw = await readFile(join(cwd, file.path), 'utf8').catch(() => undefined);

		result = raw === undefined ? { problem: `${file.name} could not be read` } : parseRecord({ name: file.name, raw, schema });
	}

	return result;
};
