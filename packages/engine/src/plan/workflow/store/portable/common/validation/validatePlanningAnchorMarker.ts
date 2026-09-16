import { parseAttachmentManifest } from '#src/common/attachmentManifest/parseAttachmentManifest.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { isDurablePlanAttachmentName } from '#src/plan/common/utils/isDurablePlanAttachmentName.ts';
import type { PlanningAnchorReference } from '#src/plan/workflow/store/portable/common/types/PlanningAnchorReference.ts';

interface Params {
	text: string;
	reference: PlanningAnchorReference;
}

/** The preserved selected marker binds the anchor even after public projections are refreshed. */
export const validatePlanningAnchorMarker = ({ text, reference }: Params): void => {
	const brainstorm = text.includes('"brainstormGeneration"');
	const parsed = parseAttachmentManifest({
		text,
		markerName: brainstorm ? 'brainstorm-attachments.json' : 'plan-attachments.json',
		isAllowedName: brainstorm
			? ({ name }) => ['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-record.json'].includes(name)
			: isDurablePlanAttachmentName,
	});
	if (
		'error' in parsed ||
		sha256({ content: text }) !== reference.markerSha256 ||
		(brainstorm ? parsed.manifest.brainstormGeneration : parsed.manifest.planningGeneration) !== reference.generation ||
		parsed.manifest.files.find((file) => file.name === (brainstorm ? 'brainstorm-record.json' : 'planning-record.json'))?.sha256 !== reference.sha256
	)
		throw new Error('Selected planning marker does not bind this original anchor');
};
