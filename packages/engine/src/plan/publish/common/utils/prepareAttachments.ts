import { readFile } from 'node:fs/promises';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { planAttachmentManifestName } from '#src/plan/common/constants/planAttachmentManifestName.ts';
import { readPlanningTransport } from '#src/plan/common/planning/readPlanningTransport.ts';
import type { DurablePlanFile } from '#src/plan/common/types/DurablePlanFile.ts';
import { validatePlanAttachmentGeneration } from '#src/plan/common/validatePlanAttachmentGeneration.ts';
import type { PreparedAttachment } from '#src/plan/publish/common/types/PreparedAttachment.ts';

interface Params {
	files: DurablePlanFile[];
	resolved?: ReadonlyMap<string, string>;
	/** The plan id the titles will be namespaced under; absent for a legacy folder. */
	titlePrefix?: string;
}

/**
 * Read a complete immutable snapshot before the first outward mutation, then
 * append the manifest that commits exactly those bytes.
 */
export const prepareAttachments = async ({ files, titlePrefix, resolved }: Params): Promise<{ attachments: PreparedAttachment[] } | { error: string }> => {
	const durable: PreparedAttachment[] = resolved ? [...resolved].map(([name, content]) => ({ name, content: Buffer.from(content) })) : [];
	// Under a prefix the brainstorm generation owns `brainstorm-notes.md`
	// outright, so the plan generation neither sends it nor commits it. A legacy
	// folder's two generations still both carry it, as they always have.
	const carried = resolved ? [] : titlePrefix === undefined ? files : files.filter(({ name }) => name !== brainstormNotesFileName);

	for (const file of carried) {
		try {
			durable.push({ name: file.name, content: await readFile(file.path) });
		} catch (error) {
			return { error: `could not read ${file.name} before publishing: ${messageOf({ error })}` };
		}
	}

	const refusal = validatePlanAttachmentGeneration({ files: durable.map(({ name, content }) => ({ name, text: content.toString('utf8') })) });

	if (refusal !== undefined) {
		return refusal;
	}

	try {
		const snapshot = readPlanningTransport({ files: new Map(durable.map(({ name, content }) => [name, content.toString('utf8')])) });
		return {
			attachments: [
				...durable,
				{ name: planAttachmentManifestName, content: serializeAttachmentManifest({ files: durable, planningGeneration: snapshot?.digest }) },
			],
		};
	} catch (error) {
		return { error: messageOf({ error }) };
	}
};
