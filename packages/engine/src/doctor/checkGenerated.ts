import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LightsoutConfig } from '@/contracts';
import type { DoctorCheck } from '@/doctor/common/types/DoctorCheck';

interface Params {
	cwd: string;
	config: LightsoutConfig;
}

/** Confirm every configured generated path exists — a missing one is a stale entry or an un-run generator. */
export const checkGenerated = async ({ cwd, config }: Params): Promise<DoctorCheck | undefined> => {
	if (!config.generated) {
		return undefined;
	}

	const absent: string[] = [];

	for (const prefix of config.generated) {
		await stat(join(cwd, prefix)).catch(() => absent.push(prefix));
	}

	return absent.length === 0
		? { id: 'generated', status: 'pass', detail: `${config.generated.length} generated path(s) exist` }
		: {
				id: 'generated',
				status: 'warn',
				detail: `not found: ${absent.join(', ')}`,
				fix: 'run the generator once, or remove stale entries from `generated`',
			};
};
