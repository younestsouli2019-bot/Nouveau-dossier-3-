const url = process.env.SITE_PUBLIC_URL;
if (!url) {
  console.log('SKIP: SITE_PUBLIC_URL not set');
  process.exit(0);
}

const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
const ok = resp.status >= 200 && resp.status < 400;
console.log(`${url} => ${resp.status} ${ok ? 'OK' : 'FAIL'}`);
if (!ok) process.exit(1);

const text = await resp.text();
if (!text || text.trim().length < 10) {
  console.log(`FAIL: response body too short (${text?.length || 0} chars)`);
  process.exit(1);
}
console.log(`Body: ${text.length} chars — OK`);
