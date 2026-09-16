import { lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { StandardsReader } from '#src/common/types/StandardsReader.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { planningPathIdentity } from '#src/plan/workflow/common/evidence/planningPathIdentity.ts';
import { readPlanningDirectory } from '#src/plan/workflow/common/evidence/readPlanningDirectory.ts';
import { readPlanningSource } from '#src/plan/workflow/common/evidence/readPlanningSource.ts';
import type { PlanningStandardsObservation } from '#src/plan/workflow/common/types/PlanningStandardsObservation.ts';

interface ConstructorParams {
	roots: string[];
}

/** Strict observed IO injected into the existing pack parser and framework detector. */
export class ObservedStandardsReader implements StandardsReader {
	readonly observations = new Map<string, PlanningStandardsObservation>();
	private readonly roots: string[];
	constructor({ roots }: ConstructorParams) {
		this.roots = roots;
	}
	private address({ path }: { path: string }) {
		const absolute = resolve(path);
		for (const root of [...this.roots].sort((a, b) => b.length - a.length)) {
			const local = relative(root, absolute);
			if (!isAbsolute(local) && local !== '..' && !local.startsWith('../')) return { cwd: root, path: local || '.' };
		}
		throw new Error(`Standards input is outside declared roots: ${path}`);
	}
	private observe({ path, kind, sha256 }: { path: string; kind: PlanningStandardsObservation['kind']; sha256: string }) {
		const observation = { path, kind, sha256 };
		const id = `${observation.kind}:${observation.path}`;
		const old = this.observations.get(id);
		if (old !== undefined && old.sha256 !== observation.sha256) throw new Error(`Standards input changed during resolution: ${observation.path}`);
		this.observations.set(id, observation);
	}
	async verify(): Promise<void> {
		const check = new ObservedStandardsReader({ roots: this.roots });
		for (const observation of this.observations.values()) {
			if (observation.kind === PlanningVocabulary.Observation.Content) await check.text({ path: observation.path });
			else if (observation.kind === PlanningVocabulary.Observation.Membership) await check.list({ path: observation.path });
			else await check.exists({ path: observation.path });
		}
		const ordered = ({ reader }: { reader: ObservedStandardsReader }) =>
			[...reader.observations.values()].sort((a, b) => `${a.path}:${a.kind}`.localeCompare(`${b.path}:${b.kind}`));
		if (canonicalJson({ value: ordered({ reader: this }) }) !== canonicalJson({ value: ordered({ reader: check }) }))
			throw new Error('Standards inputs changed during resolution; retry acquisition');
	}
	async text({ path }: { path: string }): Promise<string | undefined> {
		const source = await readPlanningSource(this.address({ path }));
		this.observe({
			path,
			kind: source === undefined ? PlanningVocabulary.Observation.Absence : PlanningVocabulary.Observation.Content,
			sha256: source?.sha256 ?? sha256({ content: 'missing' }),
		});
		return source?.content;
	}
	async list({ path, optional = false }: { path: string; optional?: boolean }) {
		const address = this.address({ path });
		const result = await readPlanningDirectory(address);
		if (result === undefined) {
			this.observe({ path, kind: PlanningVocabulary.Observation.Absence, sha256: sha256({ content: 'missing' }) });
			if (!optional) throw new Error(`Required standards directory is missing: ${path}`);
			return [];
		}
		if (result.entries.some((entry) => entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())))
			throw new Error(`Standards directory contains unobservable entries: ${path}`);
		this.observe({ path, kind: PlanningVocabulary.Observation.Membership, sha256: result.fingerprint });
		return result.entries;
	}

	async exists({ path }: { path: string }): Promise<boolean> {
		const address = this.address({ path });
		const before = await planningPathIdentity(address);
		if (!before.exists) {
			this.observe({ path, kind: PlanningVocabulary.Observation.Absence, sha256: sha256({ content: 'missing' }) });
			return false;
		}
		const status = await lstat(join(before.root, address.path));
		const after = await planningPathIdentity(address);
		if (before.identity !== after.identity) throw new Error(`Standards marker changed during resolution: ${path}`);
		if (status.isFile()) await this.text({ path });
		else if (status.isDirectory()) await this.list({ path });
		else throw new Error(`Standards marker is not a regular file or directory: ${path}`);
		this.observe({ path, kind: PlanningVocabulary.Observation.Presence, sha256: sha256({ content: status.isDirectory() ? 'directory' : 'file' }) });
		return true;
	}
}
