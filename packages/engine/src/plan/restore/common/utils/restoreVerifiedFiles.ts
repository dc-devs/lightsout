import type { AttachmentManifest } from '#src/common/types/AttachmentManifest.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { readPlanningTransport } from '#src/plan/common/planning/readPlanningTransport.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import type { ReadGenerationFile } from '#src/plan/restore/common/types/ReadGenerationFile.ts';
import { writeRestoredGeneration } from '#src/plan/restore/common/utils/writeRestoredGeneration.ts';
export const restoreVerifiedFiles = async ({
	cwd,
	name,
	files,
	manifest,
	marker,
	beforeExpose,
}: {
	cwd: string;
	name: string;
	files: ReadGenerationFile[];
	manifest: AttachmentManifest;
	marker: string;
	beforeExpose?: (params: { directory: string }) => Promise<void>;
}): Promise<{ error: string } | undefined> => {
	const record = files.find((file) => file.title === 'planning-record.json')?.text;
	try {
		if (record !== undefined && manifest.planningGeneration === undefined) throw new Error('Canonical plan requires an explicit generation marker');
		readPlanningTransport({ files: new Map(files.map((file) => [file.title, file.text])), name, planningGeneration: manifest.planningGeneration });
	} catch (error) {
		return { error: messageOf({ error }) };
	}
	const written = await writeRestoredGeneration({
		dir: planWorkspaceDir({ cwd, name }),
		files: files,
		beforeExpose,
		...(record === undefined ? {} : { planning: { name, record, marker: marker } }),
	});

	return written;
};
