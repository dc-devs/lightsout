import { isAbsolute, relative, resolve } from 'node:path';
import { documentationRule, documentationSection } from '#src/agents/index.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { listWorkspacePackages } from '#src/common/workspace/listWorkspacePackages.ts';
import { type LightsoutConfig, type PlanningDependency, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { ObservedStandardsReader } from '#src/plan/workflow/context/common/utils/ObservedStandardsReader.ts';
import { planningStandardsLocation } from '#src/plan/workflow/context/common/utils/planningStandardsLocation.ts';
import { resolveStandardsChannels } from '#src/standards/index.ts';
import { buildStandardsDocuments, resolveStandardsPackRoots, resolveStandardsPacks } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig | undefined;
	role: (typeof PlanningVocabulary.Role)[keyof typeof PlanningVocabulary.Role];
	scope: PlanningScope;
}

const standardsDependencies = ({ cwd, observations }: { cwd: string; observations: PlanningStandards['observations'] }) => {
	const dependencies: PlanningDependency[] = [];
	for (const observation of observations) {
		const path = relative(cwd, observation.path) || '.';
		if (isAbsolute(path) || path === '..' || path.startsWith('../') || observation.kind === PlanningVocabulary.Observation.Presence) continue;
		const id = `standards:${observation.kind}:${path}`;
		if (observation.kind === PlanningVocabulary.Observation.Absence) dependencies.push({ id, kind: PlanningVocabulary.Dependency.Absence, path });
		else if (observation.kind === PlanningVocabulary.Observation.Content)
			dependencies.push({ id, kind: PlanningVocabulary.Dependency.Content, path, sha256: observation.sha256 });
		else
			dependencies.push({
				id,
				kind: PlanningVocabulary.Dependency.Membership,
				root: path,
				policy: { exclude: [], recursive: false },
				fingerprint: observation.sha256,
			});
	}
	return dependencies;
};

const byPathAndKind = (a: { path: string; kind: string }, b: { path: string; kind: string }) => `${a.path}:${a.kind}`.localeCompare(`${b.path}:${b.kind}`);

/** Resolve exact existing standards text without changing planning state; the coordinator commits this stable plan-scope bundle. */
export const resolvePlanningStandards = async ({ cwd, config, scope }: Params): Promise<PlanningStandards> => {
	const packagesDir = config?.['packages-dir'] ?? defaultPackagesDir;
	const roots = resolveStandardsPackRoots({ cwd, standardsPacks: config?.['standards-packs'] });
	const reader = new ObservedStandardsReader({ roots: [resolve(cwd), ...roots] });
	const broad = scope.kind === PlanningVocabulary.Scope.WholePlan || scope.packageRoots.includes('.') || scope.packageRoots.includes(packagesDir);
	const discovered = roots.length > 0 && broad && config?.['standards-channels'] === undefined ? await listWorkspacePackages({ cwd, packagesDir, reader }) : [];
	const packages = [
		...new Set([
			...discovered,
			...scope.packageRoots.filter((root) => root.startsWith(`${packagesDir}/`)).map((root) => root.slice(packagesDir.length + 1).split('/')[0]),
		]),
	].sort();
	const includeRoot = broad || scope.packageRoots.some((root) => !root.startsWith(`${packagesDir}/`));
	const frameworkChannels = roots.length === 0 ? [] : await resolveStandardsChannels({ cwd, config, packages, reader, includeRoot });
	const packs = await resolveStandardsPacks({ cwd, config, reader });
	const rendered = packs.map((pack) => buildStandardsDocuments({ pack, channels: frameworkChannels }));
	const identity = packs.map((pack) => ({
		name: pack.name,
		formatVersion: pack.formatVersion,
		root: planningStandardsLocation({ cwd, roots, path: pack.rootPath }),
		built: pack.built,
	}));
	await reader.verify();
	// The reader records observations as its concurrent reads finish, so both lists are put in path order before anything is fingerprinted.
	const rawObservations = [...reader.observations.values()].sort(byPathAndKind);
	const observations = rawObservations
		.map((observation) => ({ ...observation, path: planningStandardsLocation({ cwd, roots, path: observation.path }) }))
		.sort(byPathAndKind);
	const policy = {
		renderer: 'planning-standards-v1',
		packages,
		frameworkChannels,
		packs: identity,
		configuredPacks: config?.['standards-packs'],
		configuredChannels: config?.['standards-channels'],
		checks: config?.['standards-checks'],
		docs: config?.docs,
		observations,
		rules: packs.flatMap((pack) =>
			pack.rules.map((rule) => ({ id: rule.id, channel: rule.channel, checked: rule.checked, settings: rule.defaultSettings, severity: rule.defaultSeverity })),
		),
	};
	const policyDigest = sha256({ content: canonicalJson({ value: policy }) });
	const channels: PlanningStandards['channels'] = [];
	for (const [channel, key] of [
		[PlanningVocabulary.Channel.Code, 'code'],
		[PlanningVocabulary.Channel.Test, 'tests'],
	] as const) {
		const texts = rendered.flatMap((documents) => (documents[key] === undefined ? [] : [documents[key]]));
		if (texts.length === 0) continue;
		const text = texts.join('\n\n');
		channels.push({ channel, sourceIdentity: canonicalJson({ value: identity }), policyDigest, text, sha256: sha256({ content: text }) });
	}
	if (config?.docs !== undefined && config.docs.length > 0) {
		const text = `Configuration-derived documentation obligations\n\n${documentationRule({ docs: config.docs })}\n\n${documentationSection({ docs: config.docs })}`;
		channels.push({
			channel: PlanningVocabulary.Channel.Docs,
			sourceIdentity: 'lightsout.config.json:docs',
			policyDigest,
			text,
			sha256: sha256({ content: text }),
		});
	}
	const dependencies = standardsDependencies({ cwd, observations: rawObservations });
	return {
		content: channels.map((channel) => `# ${channel.channel} standards\n\n${channel.text}`).join('\n\n'),
		channels,
		dependencies,
		observations,
		policyDigest,
	};
};
