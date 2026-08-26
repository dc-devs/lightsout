import { Controller, Get } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
	constructor(private readonly events: EventsService) {}

	@Get()
	list(): string[] {
		return this.events.list();
	}
}
