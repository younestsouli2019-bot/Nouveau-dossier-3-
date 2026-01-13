export function shouldAvoidPayPal() {
  const v = String(process.env.PAYPAL_DISABLED || "false").toLowerCase() === "true";
  return v;
}
