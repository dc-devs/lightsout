interface Props {
	title: string;
}

// A framework component: the first exception, so no `JSX.Element` annotation.
export const IssueTitle = ({ title }: Props) => <h2>{title}</h2>;
