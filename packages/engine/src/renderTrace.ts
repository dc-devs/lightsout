import { TraverseMode, type ConnectionDoc, type TraceState } from '@lightsout/contracts';

const labelOf = (edgeId: string) => edgeId.split('--')[2] ?? edgeId;

interface Params {
	state: TraceState;
	edges: Map<string, ConnectionDoc>;
	mode: TraverseMode;
}

/**
 * Output modes are renderers over the one trace artifact (prototype
 * decision T10) — every node, edge, and citation below comes from the
 * trace and the connection docs it crossed, derived mechanically; nothing
 * is invented. `answer`/`bug` render as the evidence chain (bug reads it
 * for the first hop where the data went wrong — the transforms are cited
 * for exactly that); `diagram` emits a Mermaid skeleton; `doc` one section
 * per hop; `plan` the per-repo change surface with schema gates.
 */
export const renderTrace = ({ state, edges, mode }: Params) => {
	const header = [`# ${state.question}`, '', `mode: ${mode} · hops: ${state.hops.length} · gaps: ${state.gaps.length} · drift: ${state.drift.length}`, ''];

	const chain = state.hops.map((hop, index) => {
		if (!hop.report) {
			return `${index + 1}. **${hop.node}** — ${hop.note ?? 'non-repo node'}`;
		}

		const lines = [`${index + 1}. **${hop.node}** via \`${hop.edge}\` (${hop.report.confidence})`, `   ${hop.report.answerContribution}`];

		for (const transform of hop.report.transforms) {
			lines.push(`   - \`${transform.at}\` — ${transform.what}`);
		}

		return lines.join('\n');
	});

	const gaps = state.gaps.length > 0 ? ['', '## Gaps — the map ends here', '', ...state.gaps.map((gap) => `- ${gap.node}: ${gap.detail}${gap.exit ? ` (\`${gap.exit.kind}\` → ${gap.exit.target} at \`${gap.exit.at}\`)` : ''}`)] : [];

	if (mode === TraverseMode.Diagram) {
		const arrows = state.hops
			.map((hop) => {
				const doc = edges.get(hop.edge);

				return doc ? `\t${doc.from} -->|${doc.type}: ${labelOf(hop.edge)}| ${doc.to}` : undefined;
			})
			.filter((line): line is string => line !== undefined);
		const notes = state.hops
			.flatMap((hop) => hop.report?.transforms.map((transform) => `- **${hop.node}** \`${transform.at}\`: ${transform.what}`) ?? []);

		return [...header, '```mermaid', 'flowchart LR', ...arrows, '```', ...(notes.length > 0 ? ['', '## Transforms along the flow', '', ...notes] : []), ...gaps, ''].join('\n');
	}

	if (mode === TraverseMode.Doc) {
		const sections = state.hops.map((hop, index) => {
			if (!hop.report) {
				return `## ${index + 1}. ${hop.node}\n\n${hop.note ?? 'non-repo node — crossed mechanically'}`;
			}

			const doc = edges.get(hop.edge);
			const parts = [
				`## ${index + 1}. ${hop.node}`,
				'',
				`**Arrives** via \`${hop.edge}\`${doc?.type ? ` (${doc.type})` : ''} — entry: ${hop.report.entry}`,
			];

			if (hop.report.transforms.length > 0) {
				parts.push('', '**Transforms:**', ...hop.report.transforms.map((transform) => `- \`${transform.at}\` — ${transform.what}`));
			}

			if (hop.report.exits.length > 0) {
				parts.push('', '**Leaves:**', ...hop.report.exits.map((exit) => `- ${exit.kind} → ${exit.target} at \`${exit.at}\` — carries ${exit.carries}${exit.conditional ? ` (when ${exit.conditional})` : ''}`));
			}

			return parts.join('\n');
		});

		return [...header, ...sections.flatMap((section) => [section, '']), ...gaps, ''].join('\n');
	}

	if (mode === TraverseMode.Plan) {
		const sections = state.hops
			.filter((hop) => hop.report)
			.map((hop) => {
				const report = hop.report;
				const doc = edges.get(hop.edge);
				const files = [...new Set([report?.entry ?? '', ...(report?.transforms.map((transform) => transform.at) ?? [])].map((at) => at.split(':')[0]).filter(Boolean))];
				const schemaGates = [doc?.schema?.from, doc?.schema?.to].filter(Boolean);

				return [
					`## ${hop.node}`,
					'',
					`- establishes: ${report?.answerContribution ?? ''}`,
					`- files on the trail: ${files.map((file) => `\`${file}\``).join(', ') || 'none cited'}`,
					...(schemaGates.length > 0 ? [`- contract change on \`${hop.edge}\` is gated by: ${schemaGates.map((file) => `\`${file}\``).join(', ')}`] : []),
				].join('\n');
			});

		return [
			...header,
			'Per-repo change surface derived from the trace — the planner decides WHAT to change; these are the verified places and contracts it touches.',
			'',
			...sections.flatMap((section) => [section, '']),
			...gaps,
			'',
		].join('\n');
	}

	// answer / bug — the evidence chain; for bug, the transforms are the
	// suspects, in flow order (the first wrong one is the culprit).
	return [...header, ...chain.flatMap((entry) => [entry, '']), ...gaps, ''].join('\n');
};
