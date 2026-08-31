import { LocalSwarmStore } from "./local-store.mjs";

class WebhookManager {
    constructor() {
        this.store = new LocalSwarmStore();
    }

    async handleWebhook(payload) {
        const { event_type, data } = payload;

        switch (event_type) {
            case "PAYMENT.CAPTURE.COMPLETED":
                return this.handlePaymentConfirmation(data);
            // Add other event types as needed
            default:
                console.log(`Unhandled webhook event type: ${event_type}`);
                return { status: "IGNORED" };
        }
    }

    async handlePaymentConfirmation(data) {
        const { id } = data;
        const revenueEventId = `RevenueEvent:${id}`; // Assuming the webhook data contains the original event ID

        try {
            const revenueEvent = await this.store.get(revenueEventId);

            if (revenueEvent) {
                revenueEvent.status = "CONFIRMED";
                revenueEvent.confirmation_details = data;
                await this.store.put(revenueEventId, revenueEvent);
                return { status: "PROCESSED" };
            } else {
                return { status: "NOT_FOUND" };
            }
        } catch (error) {
            console.error(`Error processing payment confirmation: ${error}`);
            return { status: "ERROR" };
        }
    }
}

export default WebhookManager;
