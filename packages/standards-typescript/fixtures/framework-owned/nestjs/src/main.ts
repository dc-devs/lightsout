import { NestFactory } from '@nestjs/core';
import { EventsModule } from './events/events.module';

// Nothing imports this file: the Nest CLI resolves src/main.ts by convention.
const bootstrap = async () => {
	const app = await NestFactory.create(EventsModule);

	await app.listen(3000);
};

void bootstrap();
