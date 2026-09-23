/** Whether a ticket's own record authorizes shipping it, and one sentence saying why not when it does not. */
export type WorkOrderShipEligibility = { eligible: true } | { eligible: false; reason: string };
