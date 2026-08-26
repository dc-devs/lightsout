import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A function body well past the detector's floor of 50 tokens over 5 lines, so
 * two files carrying it are unambiguously the same block written out twice.
 */
const duplicatedBody = `
	let total = 0;
	for (const record of records) {
		if (record.active && record.amount > 0) {
			total += record.amount * record.multiplier + record.bonus;
		} else if (record.pending) {
			total += record.amount / 2 - record.fee;
		} else {
			total -= record.penalty ?? 0;
		}
	}
	return total * 100;
`;

/**
 * A shared import list in every style the blanking recognises — side-effect
 * imports with no `from`, a multi-line named import, single-line named imports,
 * a default import. On its own it clears the detector's floor, so a run that
 * left it in the text would report it as duplication nobody can act on.
 */
const sharedImportBlock = `import './register-metrics';
import './register-logging';
import {
	alphaOne,
	alphaTwo,
	alphaThree,
	alphaFour,
	alphaFive,
} from './shared-one';
import { betaOne, betaTwo, betaThree, betaFour, betaFive } from './shared-two';
import { gammaOne, gammaTwo, gammaThree, gammaFour, gammaFive } from './shared-three';
import defaultThing from './shared-four';`;

/**
 * The composition remedy the standards mandate in place of `extends`: a
 * constructor that only stores its parameters on `this`, and chunky one-line
 * forwards to the collaborator it stored. Two classes holding the same
 * collaborator repeat all of it by design, and together the members clear the
 * detector's floor.
 */
const delegatingClass = ({ name }: { name: string }) => `export class ${name} {
	private readonly runState: RunState;

	constructor({ runState }: { runState: RunState }) {
		this.runState = runState;
	}

	update({ patch, reason, actor, timestamp }: { patch: object; reason: string; actor: string; timestamp: number }): Promise<void> {
		return this.runState.update({ patch, reason, actor, timestamp });
	}

	setStep({ step, index, total, label }: { step: string; index: number; total: number; label: string }): Promise<void> {
		return this.runState.setStep({ step, index, total, label });
	}
}
`;

/** Two files that write the same block out twice, and share nothing else. */
export const duplicatedSources: Record<string, string> = {
	'src/alpha.ts': `import { one } from './one';\n\nexport const alpha = ({ records }: { records: any[] }) => {${duplicatedBody}};\n`,
	'src/beta.ts': `import { one } from './one';\n\nexport const beta = ({ records }: { records: any[] }) => {${duplicatedBody}};\n`,
};

/**
 * The same duplicated block in both files, but beta's import list is four lines
 * longer — so beta's copy genuinely sits four lines below alpha's, an offset
 * that only survives if the imports were blanked in place rather than cut out.
 */
export const offsetImportSources: Record<string, string> = {
	'src/alpha.ts': `import { one } from './one';\n\nexport const alpha = ({ records }: { records: any[] }) => {${duplicatedBody}};\n`,
	'src/beta.ts': `import {\n\tone,\n\ttwo,\n\tthree,\n} from './one';\n\nexport const beta = ({ records }: { records: any[] }) => {${duplicatedBody}};\n`,
};

/** Two files whose only shared text is the import list; their bodies differ. */
export const sharedImportSources: Record<string, string> = {
	'src/alpha.ts': `${sharedImportBlock}\n\nexport const alpha = ({ records }: { records: number[] }) => records.length;\n`,
	'src/beta.ts': `${sharedImportBlock}\n\nexport const beta = ({ names }: { names: string[] }) => names.join(', ');\n`,
};

/** Two classes whose only shared text is the composition remedy. */
export const delegatingSources: Record<string, string> = {
	'src/RefactorRun.ts': delegatingClass({ name: 'RefactorRun' }),
	'src/PipelineRun.ts': delegatingClass({ name: 'PipelineRun' }),
};

/**
 * Write one of the sample sets into a directory, creating the folders it names.
 *
 * The duplication tier is driven through the engine's own surfaces — a check
 * run and a pack validation — and both need the same samples on disk, so the
 * text and the writing of it live together rather than being restated per
 * caller.
 */
export const writeSampleSources = ({ dir, sources }: { dir: string; sources: Record<string, string> }): void => {
	for (const [path, text] of Object.entries(sources)) {
		mkdirSync(join(dir, dirname(path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
};
