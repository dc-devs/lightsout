import { formatName } from '@/app/common/formatName';

export const renderApp = ({ name }: { name: string }) => `<h1>${formatName({ name })}</h1>`;
