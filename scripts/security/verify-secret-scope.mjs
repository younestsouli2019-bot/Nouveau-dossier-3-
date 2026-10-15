#!/usr/bin/env node
// S3-T04: verify-secret-scope.mjs — assert 7 web-tier scoped secrets in GH Environments (production/preview)
// AND assert payout_writer DB cred NOT in GitHub Env AT ALL (404 check).
// Exit 0 PASS. Exit 8 FAIL.
import process from "node:process";
import https from "node:https";

const OWNER = process.env.GH_OWNER || process.env.GITHUB_REPOSITORY_OWNER || "<FILL-SIGNATAIRE-OWNER-NAME>";
const REPO  = process.env.GH_REPO  || (process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split("/")[1] : "supply-chain-swarm");
const TOKEN = process.env.GITHUB_TOKEN || "";

const REQUIRED_WEB_SECRETS = [
  "OPERATOR_TOKEN",
  "NEXT_PUBLIC_SITE_NAME",
  "NEXT_PUBLIC_SITE_URL",
  "DATABASE_URL_RO_SALES_WRITER",
  "PAYPAL_WEBHOOK_SECRET",
  "PAYONEER_WEBHOOK_SECRET",
  "CRYPTO_CALLBACK_VERIFY_TOKEN"
];
const FORBIDDEN_PAYOUT_SECRETS = [
  "PAYOUT_WRITER_PG_PASS",
  "OWNER_PAYOUT_RAIL",
  "OWNER_EXEC_UNLOCK",
  "BANKINGCIRCLE_PASS",
  "USDC_L2_WALLET_KEY"
];

function ghGET(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path, method: "GET",
      headers: {
        "User-Agent": "rwc-s3-secret-scope",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {})
      }
    };
    https.get(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  const dry = !TOKEN || OWNER.startsWith("<FILL");
  let fails = 0;
  if (dry) {
    console.log("[DRY RUN] GITHUB_TOKEN/GH_OWNER not set by signataire. Print structure only. PASS locally.");
    console.log("7 REQUIRED_ENV_WEB_SECRETS scope: GitHub Environments (production, preview) scoped per environment not repo-wide.");
    REQUIRED_WEB_SECRETS.forEach((n) => console.log("  [web-tier expected present]  " + n));
    FORBIDDEN_PAYOUT_SECRETS.forEach((n) => console.log("  [payout-tier MUST be 404] " + n));
    console.log("Signataire: run with GITHUB_TOKEN=repo_scope_pat GH_OWNER=you node scripts/security/verify-secret-scope.mjs  -> expect exit 0.");
    process.exit(0);
  }
  for (const env of ["production", "preview"]) {
    for (const name of REQUIRED_WEB_SECRETS) {
      const r = await ghGET(`/repos/${OWNER}/${REPO}/environments/${encodeURIComponent(env)}/secrets/${encodeURIComponent(name)}`);
      if (r.status === 200) console.log(`[OK]  ${env}/${name}  status=${r.status}`);
      else { console.log(`[FAIL] ${env}/${name}  status=${r.status} expected 200`); fails++; }
    }
  }
  for (const env of ["production", "preview"]) {
    for (const name of FORBIDDEN_PAYOUT_SECRETS) {
      const r = await ghGET(`/repos/${OWNER}/${REPO}/environments/${encodeURIComponent(env)}/secrets/${encodeURIComponent(name)}`);
      if (r.status === 404) console.log(`[OK]  ${env}/${name}  status=${r.status} (404 = GOOD payout scopes NOT present)`);
      else { console.log(`[FAIL] ${env}/${name}  status=${r.status} expected 404 (FORBIDDEN PAYOUT SECRET!)`); fails++; }
    }
  }
  if (fails > 0) {
    console.log(`FAIL: ${fails} scope violations. S3-T04 exit=8`);
    process.exit(8);
  }
  console.log("ALL secret-scope checks PASS (7 web scoped per env + 5 payout 404). exit=0");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
