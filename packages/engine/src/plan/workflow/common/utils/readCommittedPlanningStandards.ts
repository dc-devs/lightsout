import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningStandardsBundle } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Read exact generation-owned standards, refusing missing, substituted or mismatched channel bytes. */
export const readCommittedPlanningStandards = ({ snapshot }: Params): PlanningStandardsBundle => {
	const path = 'planning-standards.json';
	const text = snapshot.artifacts.get(path);
	if (text === undefined) {
		throw new Error('The committed standards bundle is missing');
	}
	const descriptor = snapshot.record.artifacts.find((artifact) => artifact.path === path);
	if (descriptor?.sha256 !== sha256({ content: text })) throw new Error('The committed standards bundle checksum does not match');
	const bundle = PlanningStandardsBundle.parse(JSON.parse(text));
	if (bundle.channels.length !== snapshot.record.standards.length) throw new Error('Standards descriptors do not cover the complete bundle');
	for (const channel of bundle.channels) {
		if (sha256({ content: channel.text }) !== channel.sha256) throw new Error(`Changed committed standards bytes: ${channel.channel}`);
		const declared = snapshot.record.standards.find((standard) => standard.channel === channel.channel);
		const { text: _text, ...identity } = channel;
		if (canonicalJson({ value: declared }) !== canonicalJson({ value: { ...identity, artifact: path } }))
			throw new Error(`Standards descriptor does not bind its channel: ${channel.channel}`);
	}
	return bundle;
};
