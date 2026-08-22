import fs from "node:fs";
import path from "node:path";

function getArg(name) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i < process.argv.length - 1) return process.argv[i + 1];
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function main() {
  const to = getArg("--to") || "help-loginappreview@paypal.com";
  const fromEmail = getArg("--from") || "";
  const accountEmail = getArg("--account-email") || fromEmail;
  const businessName = getArg("--business-name") || "";
  const subject = getArg("--subject") || "Escalation: Activate API Payouts and Pending Permissions";
  const debugIds = String(getArg("--debug-ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const endpoint = getArg("--endpoint") || "/v1/payments/payouts";
  const statusCode = getArg("--status-code") || "403";
  const attijariUrl = getArg("--attijari-url") || "";
  const domainUrl = getArg("--domain-url") || "";
  const domainStatus = getArg("--domain-status") || "";
  const firstDate = getArg("--first-request-date") || "";
  const followupDate = getArg("--followup-date") || "";
  const phone = getArg("--phone") || "";

  const payload = {
    to,
    from_email: fromEmail,
    account_email: accountEmail,
    business_name: businessName,
    subject,
    requested: {
      activate_api_payouts: true,
      pending_permissions: ["Login with PayPal", "Customer Disputes"],
      endpoint: endpoint,
      status_code: statusCode
    },
    timeline: {
      first_request_date: firstDate,
      followup_date: followupDate,
      created_at: nowIso()
    },
    evidence: {
      debug_ids: debugIds,
      attijari_portal_url: attijariUrl,
      domain_url: domainUrl,
      domain_status: domainStatus
    },
    contact: {
      name: "Younes Tsouli",
      phone
    }
  };

  const lines = [];
  lines.push(subject);
  lines.push("");
  lines.push("Dear PayPal Support Team,");
  lines.push("");
  lines.push("I request activation of API Payouts and resolution of pending permissions blocking integration.");
  lines.push("");
  lines.push("Account Details:");
  lines.push(`• PayPal Account Email: ${accountEmail}`);
  if (businessName) lines.push(`• Business Name: ${businessName}`);
  lines.push("");
  lines.push("Observed Errors:");
  lines.push(`• Endpoint: ${endpoint}`);
  lines.push(`• Status: ${statusCode}`);
  if (debugIds.length) lines.push(`• Debug IDs: ${debugIds.join(", ")}`);
  lines.push("");
  lines.push("Pending Permissions:");
  lines.push("• Login with PayPal");
  lines.push("• Customer Disputes");
  lines.push("");
  if (attijariUrl) {
    lines.push("Portal Access:");
    lines.push(`• Attijariwafa PayPal: ${attijariUrl}`);
    lines.push("");
  }
  if (domainUrl) {
    lines.push("Business Domain:");
    lines.push(`• ${domainUrl} (${domainStatus})`);
    lines.push("");
  }
  lines.push("Request:");
  lines.push("1) Activate API Payouts or provide required steps");
  lines.push("2) Approve pending permissions or clarify documentation needed");
  lines.push("3) Provide an estimated timeline for activation");
  lines.push("");
  lines.push("Timeline:");
  if (firstDate) lines.push(`• Initial request: ${firstDate}`);
  if (followupDate) lines.push(`• Follow-up: ${followupDate}`);
  lines.push("");
  lines.push("Contact:");
  lines.push(`• ${payload.contact.name} (${accountEmail})`);
  if (phone) lines.push(`• ${phone}`);
  lines.push("");
  lines.push("Thank you for your assistance.");
  lines.push("");
  lines.push("Best regards,");
  lines.push(payload.contact.name);

  const outDir = path.resolve("out/paypal/escalation");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const base = `paypal_escalation_${Date.now()}`;
  const txtPath = path.join(outDir, `${base}.txt`);
  const jsonPath = path.join(outDir, `${base}.json`);
  fs.writeFileSync(txtPath, lines.join("\n"), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ ok: true, txt: txtPath, json: jsonPath }) + "\n");
}

main();
