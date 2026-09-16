import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { flushPlanningDirectory } from '#src/plan/workflow/store/common/utils/flushPlanningDirectory.ts';
import { writePlanningBlob } from '#src/plan/workflow/store/common/utils/writePlanningBlob.ts';
import { validatePlanningAnchorMarker } from '#src/plan/workflow/store/portable/common/validation/validatePlanningAnchorMarker.ts';
import { validatePlanningGeneration } from '#src/plan/workflow/store/portable/validatePlanningGeneration.ts';

interface Params {
	directory: string;
	name: string;
	text: string;
	expectedDigest: string;
	marker?: string;
}

/** Install in a new private restore directory before its caller exposes the complete generation atomically. */
export const installPlanningGeneration = async ({ directory, name, text, expectedDigest, marker }: Params): Promise<PlanningSnapshot> => {
	const snapshot = validatePlanningGeneration({ text, expectedDigest, name });
	const reference = {
		format: 'planning-anchor-v1' as const,
		sha256: expectedDigest,
		generation: snapshot.digest,
		...(marker === undefined ? {} : { markerSha256: sha256({ content: marker }) }),
	};
	if (marker !== undefined) validatePlanningAnchorMarker({ text: marker, reference });
	const directoryInfo = await lstat(directory);
	if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Planning restore requires a real private directory');
	const root = join(directory, '.planning');
	await mkdir(root);
	for (const child of ['blobs', 'commits', 'staging', 'local']) await mkdir(join(root, child));
	for (const descriptor of snapshot.record.artifacts) {
		const content = snapshot.artifacts.get(descriptor.path);
		if (content !== undefined) await writePlanningBlob({ path: join(root, 'blobs', descriptor.sha256), text: content });
	}
	await writePlanningBlob({ path: join(root, 'blobs', expectedDigest), text });
	await flushPlanningDirectory({ path: join(root, 'blobs') });
	if (marker !== undefined) await writePlanningBlob({ path: join(root, 'selected-marker.json'), text: marker });
	await writePlanningBlob({
		path: join(root, 'anchor.json'),
		text: canonicalJson({ value: reference }),
	});
	await flushPlanningDirectory({ path: root });
	await flushPlanningDirectory({ path: directory });
	return snapshot;
};
