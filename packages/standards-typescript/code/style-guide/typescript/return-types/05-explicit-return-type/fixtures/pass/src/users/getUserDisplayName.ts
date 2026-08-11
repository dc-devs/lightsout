interface Params {
	user: { name: string | null } | null;
}

// Private helper — inferred, because the consumer is in this file.
const normalizeName = ({ name }: { name: string | null }) => name?.trim() ?? '';

export const getUserDisplayName = ({ user }: Params): string => normalizeName({ name: user?.name ?? null }) || 'Unknown';
