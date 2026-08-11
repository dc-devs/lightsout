import { buildGreeting } from './buildGreeting';

export const renderGreeting = ({ name }: { name: string }): string => `<p>${buildGreeting({ name })}</p>`;
