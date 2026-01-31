export function shouldAvoidPayPal() {
	const disabled =
		String(process.env.PAYPAL_DISABLED || "false").toLowerCase() === "true";
	const bunker =
		String(process.env.BUNKER_MODE || "false").toLowerCase() === "true";
	const approved =
		String(
			process.env.PAYPAL_PPP2_APPROVED || process.env.PPP2_APPROVED || "false",
		).toLowerCase() === "true";
	const sendEnabled =
		String(
			process.env.PAYPAL_PPP2_ENABLE_SEND ||
				process.env.PPP2_ENABLE_SEND ||
				"false",
		).toLowerCase() === "true";
	return disabled || bunker || !(approved && sendEnabled);
}
