import { renderDocsSurfaces } from '#src/agents/common/utils/renderDocsSurfaces.ts';
import type { ConfigDocs } from '#src/contracts/index.ts';

interface Params {
	docs: ConfigDocs;
}

/** The writer's brief on the surfaces this repository declared, and what its plan must say about them. */
export const documentationSection = ({ docs }: Params): string =>
	`## Documentation surfaces

This repository declares the documents below. Your plan MUST carry a
\`## Documentation\` section in every implementable file it writes, stating
either the declared documents this plan touches or the exact sentence
\`Nothing user-facing — no docs needed.\`

${renderDocsSurfaces({ docs })}

A document you name in that section must also appear under one of the plan's
file headings, so the executor actually edits it. Naming a document the list
below does not hold, or claiming nothing user-facing while the plan adds a
command, a flag, a config key or a user-invoked prompt, is what \`plan grade\`
reports.`;
