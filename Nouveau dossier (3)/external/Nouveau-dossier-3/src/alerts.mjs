export async function maybeSendAlert(base44, { subject, body }) {
  const enabled = (process.env.BASE44_ENABLE_ALERTS ?? "false").toLowerCase() === "true";
  if (!enabled) return { sent: false };

  const to = process.env.BASE44_ALERT_EMAIL_TO;
  if (!to) throw new Error("Missing required env var: BASE44_ALERT_EMAIL_TO");

  const fromName = process.env.BASE44_ALERT_FROM_NAME ?? undefined;

  const integrations = base44?.asServiceRole?.integrations ?? base44?.integrations;
  if (!integrations?.Core?.SendEmail) {
    throw new Error("Base44 SendEmail integration not available on this client");
  }

  const result = await integrations.Core.SendEmail({
    to,
    subject,
    body,
    ...(fromName ? { from_name: fromName } : {})
  });

  return { sent: true, result };
}

