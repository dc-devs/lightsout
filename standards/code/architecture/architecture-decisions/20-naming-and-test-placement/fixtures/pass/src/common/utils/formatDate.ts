export const formatDate = ({ date }: { date: Date }): string => date.toISOString().slice(0, 10);
