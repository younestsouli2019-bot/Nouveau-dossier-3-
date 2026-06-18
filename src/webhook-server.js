import bodyParser from "body-parser";
import express from "express";
import WebhookManager from "./webhook-manager.js";
import WebhookValidator from "./webhook-validator.js";

const app = express();
const port = process.env.WEBHOOK_PORT || 3000;
const webhookValidator = new WebhookValidator();

app.use(bodyParser.json());

const webhookManager = new WebhookManager();

// Middleware for webhook validation
const validateWebhook = (req, res, next) => {
	try {
		// Check for API key authorization first
		const apiKey = req.headers["x-api-key"];
		const authHeader = req.headers.authorization;

		if (apiKey) {
			// Validate API key
			if (apiKey !== process.env.WEBHOOK_API_KEY) {
				return res.status(401).json({ error: "Invalid API key" });
			}
		} else if (authHeader?.startsWith("Bearer ")) {
			// Validate Bearer token
			const token = authHeader.substring(7);
			if (token !== process.env.WEBHOOK_BEARER_TOKEN) {
				return res.status(401).json({ error: "Invalid Bearer token" });
			}
		} else {
			// No authorization provided - check for PayPal webhook signature
			try {
				webhookValidator.validatePayPalWebhook(req);
			} catch (error) {
				console.error("Webhook validation failed:", error.message);
				return res
					.status(401)
					.json({ error: "Webhook validation failed", message: error.message });
			}
		}

		next();
	} catch (error) {
		console.error("Webhook authorization error:", error);
		res.status(401).json({ error: "Unauthorized", message: error.message });
	}
};

app.post("/webhook", validateWebhook, async (req, res) => {
	try {
		const result = await webhookManager.handleWebhook(req.body);
		res.status(200).json(result);
	} catch (error) {
		console.error("Webhook processing error:", error);
		res
			.status(500)
			.json({ error: "Internal server error", message: error.message });
	}
});

// Health check endpoint
app.get("/health", (_req, res) => {
	res.status(200).json({
		status: "healthy",
		timestamp: new Date().toISOString(),
		webhookValidation: "enabled",
	});
});

app.listen(port, () => {
	console.log(`Webhook server listening on port ${port}`);
	console.log(`Webhook validation: enabled`);
});
