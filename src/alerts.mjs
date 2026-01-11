export async function maybeSendAlert(base44, { subject, body }) {
  const enabled = (process.env.BASE44_ENABLE_ALERTS ?? "false").toLowerCase() === "true";
  if (!enabled) return { sent: false, reason: "alerts_disabled" };

  const to = process.env.BASE44_ALERT_EMAIL_TO;
  if (!to) return { sent: false, reason: "missing_alert_recipient" };

  const fromName = process.env.BASE44_ALERT_FROM_NAME ?? undefined;

  const integrations = base44?.asServiceRole?.integrations ?? base44?.integrations;
  if (!integrations?.Core?.SendEmail) {
    return { sent: false, reason: "sendemail_integration_unavailable" };
  }

  try {
    const result = await integrations.Core.SendEmail({
      to,
      subject,
      body,
      ...(fromName ? { from_name: fromName } : {})
    });
    return { sent: true, result };
  } catch (e) {
    return { sent: false, reason: e?.message ?? String(e) };
  }
}

