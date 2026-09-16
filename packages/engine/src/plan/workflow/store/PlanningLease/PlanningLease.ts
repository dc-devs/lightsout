import { randomUUID } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningStoreIO } from '#src/plan/workflow/common/types/PlanningStoreIO.ts';
import { flushPlanningDirectory } from '#src/plan/workflow/store/common/utils/flushPlanningDirectory.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';
import { planningStorePaths } from '#src/plan/workflow/store/common/utils/planningStorePaths.ts';
import { PlanningLeaseStatus } from '#src/plan/workflow/store/PlanningLease/common/constants/PlanningLeaseStatus.ts';
import { commitPlanningLease } from '#src/plan/workflow/store/PlanningLease/common/utils/commitPlanningLease.ts';
import { readPlanningLease } from '#src/plan/workflow/store/PlanningLease/common/utils/readPlanningLease.ts';

interface ConstructorParams {
	io?: PlanningStoreIO;
	cwd: string;
	name: string;
	token?: string;
	pid?: number;
	now?: () => number;
	durationMs?: number;
}

/** A local immutable journal fences recovery races; canonical work CAS still selects the sole dispatcher. */
export class PlanningLease {
	private readonly cwd: string;
	private readonly name: string;
	private readonly token: string;
	private readonly pid: number;
	private readonly now: () => number;
	private readonly durationMs: number;
	private readonly io?: PlanningStoreIO;

	constructor({ cwd, name, token = randomUUID(), pid = process.pid, now = Date.now, durationMs = 30000, io }: ConstructorParams) {
		if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Planning lease duration must be positive');
		this.cwd = cwd;
		this.name = name;
		this.token = token;
		this.pid = pid;
		this.now = now;
		this.durationMs = durationMs;
		this.io = io;
	}

	private async address({ attemptId }: { attemptId: string }) {
		const paths = await planningStorePaths({ cwd: this.cwd, name: this.name, create: true });
		const directory = join(paths.local, `lease-${sha256({ content: attemptId })}`);
		try {
			await mkdir(directory);
		} catch (error) {
			if (!(planningErrorCode({ error }) === 'EEXIST')) throw error;
		}
		const status = await lstat(directory);
		if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Planning lease directory cannot be redirected');
		await flushPlanningDirectory({ path: paths.local });
		return directory;
	}

	async create({ attemptId }: { attemptId: string }): Promise<void> {
		const directory = await this.address({ attemptId });
		const committed = await commitPlanningLease({
			directory,
			io: this.io,
			entry: {
				revision: 0,
				parentDigest: null,
				attemptId,
				token: this.token,
				pid: this.pid,
				expiresAt: this.now() + this.durationMs,
				state: PlanningLeaseStatus.Active,
			},
		});
		if (!committed) throw new Error('Planning attempt already owns a lease journal');
	}

	async fenceExpired({ attemptId }: { attemptId: string }): Promise<boolean> {
		const directory = await this.address({ attemptId });
		for (;;) {
			const current = await readPlanningLease({ directory, attemptId });
			if (current === undefined) throw new Error('Active planning attempt has no verifiable local lease');
			if (current.entry.state === PlanningLeaseStatus.Fenced) return true;
			if (current.entry.expiresAt > this.now()) return false;
			const committed = await commitPlanningLease({
				directory,
				io: this.io,
				entry: { ...current.entry, revision: current.entry.revision + 1, parentDigest: current.digest, state: PlanningLeaseStatus.Fenced },
			});
			if (committed) return true;
		}
	}

	async renew({ attemptId }: { attemptId: string }): Promise<void> {
		const directory = await this.address({ attemptId });
		let committed = false;
		while (!committed) {
			const current = await readPlanningLease({ directory, attemptId });
			if (current === undefined || current.entry.token !== this.token || current.entry.pid !== this.pid)
				throw new Error('A different planning owner cannot renew this attempt');
			if (current.entry.state === PlanningLeaseStatus.Fenced) throw new Error('A fenced planning lease cannot be revived');
			const now = this.now();
			if (current.entry.expiresAt <= now) throw new Error('Planning renewal started after recovery became eligible');
			committed = await commitPlanningLease({
				directory,
				io: this.io,
				entry: {
					...current.entry,
					revision: current.entry.revision + 1,
					parentDigest: current.digest,
					expiresAt: Math.max(current.entry.expiresAt, now + this.durationMs),
				},
			});
		}
	}
}
