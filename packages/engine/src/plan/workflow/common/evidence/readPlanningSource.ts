import { sha256 } from '#src/common/utils/sha256.ts';
import { readPlanningBytes } from '#src/plan/workflow/common/evidence/readPlanningBytes.ts';

interface Params {
	cwd: string;
	path: string;
}

/** Read requested text without treating unavailable, binary or unsafe inputs as absence. */
export const readPlanningSource = async ({ cwd, path }: Params): Promise<{ content: string; sha256: string } | undefined> => {
	const bytes = await readPlanningBytes({ cwd, path });
	if (bytes === undefined) return undefined;
	const content = bytes.toString('utf8');
	if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error(`Requested planning source is not UTF-8 text: ${path}`);
	return { content, sha256: sha256({ content: bytes }) };
};
