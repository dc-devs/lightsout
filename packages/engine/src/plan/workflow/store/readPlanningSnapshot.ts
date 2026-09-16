import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningDigest } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningCommit } from '#src/plan/workflow/store/common/types/PlanningCommit.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';
import { planningStorePaths } from '#src/plan/workflow/store/common/utils/planningStorePaths.ts';
import { readPlanningFile } from '#src/plan/workflow/store/common/utils/readPlanningFile.ts';
import { validatePlanningArtifactBodies } from '#src/plan/workflow/store/common/validation/validatePlanningArtifactBodies.ts';
import { validatePlanningTransition } from '#src/plan/workflow/store/common/validation/validatePlanningTransition.ts';
import { readPlanningAnchor } from '#src/plan/workflow/store/portable/index.ts';
import { validatePlanningRecord } from '#src/plan/workflow/store/validatePlanningRecord.ts';

interface Params {
	cwd: string;
	name: string;
	generation?: string;
}

// A proof memo retains only checksums of fully validated immutable commit bytes.
// Every read still acquires all commit and blob bytes and checks current chain linkage.
// Parsed records are never shared with callers or cached, so caller edits cannot poison it.
const validationCacheLimit = 1_024;

class PlanningValidationProofs {
	private readonly digests = new Set<string>();

	has({ digest }: { digest: string }): boolean {
		return this.digests.has(digest);
	}

	admit({ digests }: { digests: string[] }): void {
		for (const digest of digests) {
			this.digests.delete(digest);
			this.digests.add(digest);
			for (const oldest of this.digests) {
				if (this.digests.size <= validationCacheLimit) break;
				this.digests.delete(oldest);
			}
		}
	}
}

const validatedCommits = new PlanningValidationProofs();

const readGeneration = async ({
	path,
	blobs,
	name,
	revision,
	parentDigest,
	verifiedBlobs,
	omittedObservations,
}: {
	path: string;
	blobs: string;
	name: string;
	revision: number;
	parentDigest: string | null;
	verifiedBlobs: Map<string, string>;
	omittedObservations: PlanningSnapshot['omittedObservations'];
}) => {
	const bytes = await readPlanningFile({ path });
	const proofDigest = sha256({ content: bytes });
	const reused = validatedCommits.has({ digest: proofDigest });
	const parsed: unknown = JSON.parse(bytes.toString('utf8'));
	// A matching proof identifies the exact JSON bytes previously schema-validated,
	// including canonical encoding, record checksum, graph, bodies and transition.
	const { record, digest } = reused ? (parsed as PlanningCommit) : PlanningCommit.parse(parsed);
	if (!reused) {
		if (!bytes.equals(Buffer.from(canonicalJson({ value: { digest, record } }), 'utf8')))
			throw new Error(`Noncanonical or corrupt planning commit bytes: ${path}`);
		if (sha256({ content: canonicalJson({ value: record }) }) !== digest) throw new Error(`Corrupt planning commit checksum: ${path}`);
		const validation = validatePlanningRecord({ record });
		if (!validation.valid) throw new Error(`Invalid planning record at ${path}: ${JSON.stringify(validation.issues)}`);
	}
	if (record.planName !== name || record.revision !== revision || record.parentDigest !== parentDigest)
		throw new Error(`Invalid planning commit chain at ${path}`);
	const artifacts = new Map<string, string>();
	for (const descriptor of record.artifacts) {
		let content = verifiedBlobs.get(descriptor.sha256);
		if (content === undefined) {
			let bytes: Buffer;
			try {
				bytes = await readPlanningFile({ path: join(blobs, descriptor.sha256) });
			} catch (error) {
				if (
					planningErrorCode({ error }) === 'ENOENT' &&
					omittedObservations?.some((item) => item.path === descriptor.path && item.sha256 === descriptor.sha256)
				)
					continue;
				throw error;
			}
			content = bytes.toString('utf8');
			if (sha256({ content: bytes }) !== descriptor.sha256 || !Buffer.from(content, 'utf8').equals(bytes))
				throw new Error(`Corrupt committed planning artifact: ${descriptor.path}`);
			verifiedBlobs.set(descriptor.sha256, content);
		}
		artifacts.set(descriptor.path, content);
	}
	if (!reused) validatePlanningArtifactBodies({ record, artifacts });
	return { snapshot: { record, digest, artifacts, ...(omittedObservations ? { omittedObservations } : {}) }, proofDigest, reused };
};

/** Read one pinned generation only after verifying the complete committed chain; corruption never falls back to an older approval. */
export const readPlanningSnapshot = async ({ cwd, name, generation }: Params): Promise<PlanningSnapshot | undefined> => {
	if (generation !== undefined) PlanningDigest.parse(generation);
	const paths = await planningStorePaths({ cwd, name });
	let names: string[] = [];
	try {
		names = await readdir(paths.commits);
	} catch (error) {
		if (!(planningErrorCode({ error }) === 'ENOENT')) throw error;
	}
	const commits = names.filter((entry) => entry.endsWith('.json')).sort();
	const verifiedBlobs = new Map<string, string>();
	const proofs: string[] = [];
	let current = await readPlanningAnchor({ root: paths.root, blobs: paths.blobs, name });
	const firstRevision = current ? current.record.revision + 1 : 0;
	let selected = generation === undefined || generation === current?.digest ? current : undefined;
	for (const [index, filename] of commits.entries()) {
		const revision = firstRevision + index;
		if (filename !== `${String(revision).padStart(10, '0')}.json`) throw new Error(`Noncontiguous planning commit chain: ${filename}`);
		const previous = current;
		const read = await readGeneration({
			path: join(paths.commits, filename),
			blobs: paths.blobs,
			verifiedBlobs,
			omittedObservations: current?.omittedObservations,
			name,
			revision,
			parentDigest: current?.digest ?? null,
		});
		current = read.snapshot;
		if (!read.reused) validatePlanningTransition({ previous, record: current.record, artifacts: current.artifacts });
		proofs.push(read.proofDigest);
		if (proofs.length > validationCacheLimit) proofs.shift();
		if (generation === undefined || current.digest === generation) selected = current;
	}
	if (generation !== undefined && selected === undefined) throw new Error(`Missing pinned planning generation: ${generation}`);
	// Admit after the complete scan: evicting during an oldest-to-newest scan
	// would discard a cached tail before reaching it when history exceeds capacity.
	validatedCommits.admit({ digests: proofs });
	return selected;
};
