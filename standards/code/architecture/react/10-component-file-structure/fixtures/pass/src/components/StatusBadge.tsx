interface Props {
	status: 'connected' | 'notInstalled';
}

export const StatusBadge = ({ status }: Props) => <span className={status}>{status}</span>;
