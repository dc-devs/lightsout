import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';
import type { PackageDir } from '#src/doctor/common/types/PackageDir.ts';

const packageDependencies = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
});

interface Params {
	packageDirs: PackageDir[];
}

/**
 * The component-test standards mandate userEvent only where the package
 * depends on it — agents never add deps mid-run, so the doctor is where the
 * recommendation surfaces for packages still on fireEvent.
 */
export const checkUserEvent = async ({ packageDirs }: Params): Promise<DoctorCheck | undefined> => {
	const fireEventOnly: string[] = [];

	for (const { label, dir } of packageDirs) {
		const raw = await readFile(join(dir, 'package.json'), 'utf8').catch(() => undefined);

		let json: unknown;

		try {
			json = raw === undefined ? undefined : JSON.parse(raw);
		} catch {
			continue;
		}

		const parsed = json === undefined ? undefined : packageDependencies.safeParse(json);

		if (!parsed?.success) {
			continue;
		}

		const dependencies = { ...parsed.data.dependencies, ...parsed.data.devDependencies };
		const hasTestingLibrary = ['@testing-library/react', '@testing-library/preact'].some((name) => name in dependencies);

		if (hasTestingLibrary && !('@testing-library/user-event' in dependencies)) {
			fireEventOnly.push(label);
		}
	}

	if (fireEventOnly.length === 0) {
		return undefined;
	}

	return {
		id: 'user-event',
		status: 'note',
		detail: `${fireEventOnly.join(', ')}: has @testing-library/react but not @testing-library/user-event — component tests will use fireEvent; consider installing user-event for full interaction simulation`,
	};
};
