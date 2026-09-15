import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningDependency, type PlanningEvidence, PlanningEvidenceRequest, PlanningVocabulary } from '#src/contracts/index.ts';
import { collectSourceEvidence } from '#src/plan/evidence/index.ts';
import { fingerprintUnknownPlanningReach } from '#src/plan/workflow/common/evidence/fingerprintUnknownPlanningReach.ts';
import { planningEvidencePolicy } from '#src/plan/workflow/common/evidence/planningEvidencePolicy.ts';
import { readPlanningSource } from '#src/plan/workflow/common/evidence/readPlanningSource.ts';
import { readPlanningUniverse } from '#src/plan/workflow/common/evidence/readPlanningUniverse.ts';
import { searchPlanningUniverse } from '#src/plan/workflow/common/evidence/searchPlanningUniverse.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';

/** Execute one declared observation while retaining exact source bytes and namespace predicates. */
const acquirePlanningObservation = async ({
	cwd,
	id,
	request,
}: {
	cwd: string;
	id: string;
	request: PlanningEvidenceRequest;
}): Promise<{
	dependencies: PlanningDependency[];
	sources: Map<string, string>;
	content: string;
	unknown: boolean;
	omissions: Array<{ path: string; kind: string; target?: string }>;
}> => {
	const dependencies: PlanningDependency[] = [];
	const sources = new Map<string, string>();
	let content: string;
	let unknown = false;
	let omissions: Array<{ path: string; kind: string; target?: string }> = [];
	switch (request.operation) {
		case PlanningVocabulary.Operation.ReadFile:
		case PlanningVocabulary.Operation.ReadRange: {
			const source = await readPlanningSource({ cwd: cwd, path: request.path });
			if (source === undefined) {
				dependencies.push({ id, kind: PlanningVocabulary.Dependency.Absence, path: request.path });
				content = canonicalJson({ value: { path: request.path, exists: false } });
			} else {
				dependencies.push({ id, kind: PlanningVocabulary.Dependency.Content, path: request.path, sha256: source.sha256 });
				sources.set(request.path, source.content);
				content = source.content;
				if (request.operation === PlanningVocabulary.Operation.ReadRange) {
					const lines = source.content.split(/\r?\n/);
					if (request.endLine > lines.length) throw new Error(`Requested range exceeds ${request.path}: ${lines.length} lines are available`);
					content = lines
						.slice(request.startLine - 1, request.endLine)
						.map((line, index) => `${request.startLine + index}: ${line}`)
						.join('\n');
				}
			}
			break;
		}
		case PlanningVocabulary.Operation.List: {
			const result = await readPlanningUniverse({ cwd: cwd, roots: [request.root], exclude: request.exclude, hashFiles: false });
			content = canonicalJson({ value: result.members });
			dependencies.push({
				id,
				kind: PlanningVocabulary.Dependency.Membership,
				root: request.root,
				policy: { exclude: request.exclude },
				fingerprint: sha256({ content }),
			});
			unknown = result.unknown;
			omissions = result.members.filter((member) => member.kind === 'symlink' || member.kind === 'other');
			break;
		}
		case PlanningVocabulary.Operation.Search: {
			const result = await searchPlanningUniverse({ cwd: cwd, request });
			content = canonicalJson({ value: result.matches });
			dependencies.push({
				id,
				kind: PlanningVocabulary.Dependency.Search,
				roots: request.roots,
				query: request.query,
				options: request.options,
				universeFingerprint: result.universeFingerprint,
				resultFingerprint: result.resultFingerprint,
			});
			for (const [path, text] of result.sources) sources.set(path, text);
			unknown = result.unknown;
			omissions = result.omissions;
			break;
		}
	}
	return { dependencies, sources, content, unknown, omissions };
};

interface Params {
	runtime: PlanningRuntime;
	assignmentId: string;
	request: PlanningEvidenceRequest;
}

/** Acquire a requested observation and its complete reuse predicates; semantic conclusions remain the agent's work. */
export const readPlanningEvidence = async ({
	runtime,
	assignmentId,
	request: proposed,
}: Params): Promise<{ evidence: PlanningEvidence; content: string; omissions?: Array<{ path: string; kind: string; target?: string }> }> => {
	const parsed = PlanningEvidenceRequest.parse(proposed);
	const policy = planningEvidencePolicy({
		exclude:
			parsed.operation === PlanningVocabulary.Operation.Search
				? parsed.options.exclude
				: parsed.operation === PlanningVocabulary.Operation.List
					? parsed.exclude
					: [],
	});
	const request =
		parsed.operation === PlanningVocabulary.Operation.Search
			? { ...parsed, options: { ...parsed.options, exclude: policy.exclude } }
			: parsed.operation === PlanningVocabulary.Operation.List
				? { ...parsed, exclude: policy.exclude }
				: parsed;
	const id = `dependency:${sha256({ content: canonicalJson({ value: request }) })}`;
	const { dependencies, sources, content, unknown, omissions } = await acquirePlanningObservation({ cwd: runtime.cwd, id, request });
	if (unknown) {
		const roots = ['.'];
		const { requestId: _requestId, reason: _reason, ...predicate } = request;
		dependencies.push({
			id: `dependency:${sha256({ content: canonicalJson({ value: { predicate, policy } }) })}:unknown`,
			kind: PlanningVocabulary.Dependency.Unknown,
			roots,
			reason: 'The requested namespace contains unobserved symbolic links or special files',
			policy,
			fallbackFingerprint: await fingerprintUnknownPlanningReach({ cwd: runtime.cwd, roots, policy }),
		});
	}
	if (sources.size > 0)
		await collectSourceEvidence({
			cwd: runtime.cwd,
			name: runtime.name,
			config: runtime.config,
			targets: [...sources.keys()].map((path) => ({ path, role: request.reason })),
			sourceBytes: sources,
		});
	const evidence: PlanningEvidence = {
		id: `evidence:${sha256({ content: canonicalJson({ value: { assignmentId, request, dependencies } }) })}`,
		assignmentId,
		claimIds: [],
		dependencies,
		conclusion: '',
		uncertaintyIds: [],
		complete: true,
		acquisition: canonicalJson({ value: { format: 'planning-evidence-v1', request } }),
		dependencyReach: unknown ? PlanningVocabulary.DependencyReach.Unknown : PlanningVocabulary.DependencyReach.Known,
		sourceIds: [...sources.keys()],
		configDigest: sha256({ content: canonicalJson({ value: runtime.config }) }),
		standardsDigest: sha256({ content: runtime.standards }),
	};
	return { evidence, content, ...(omissions.length > 0 ? { omissions } : {}) };
};
