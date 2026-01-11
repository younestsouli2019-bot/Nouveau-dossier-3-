#!/usr/bin/env node
import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'

function isHex64(s){ return typeof s==='string' && /^[0-9a-fA-F]{64}$/.test(s) }
function looksSimulatedId(s){ return typeof s==='string' && /^(sim_|pyr_sim_)/i.test(s) }
function deepGet(obj, keys){ let cur=obj; for(const k of keys){ if(!cur || typeof cur!=='object') return undefined; cur=cur[k]; } return cur }
function deepSet(obj, keys, val){ let cur=obj; for(let i=0;i<keys.length-1;i++){ const k=keys[i]; if(!cur[k]||typeof cur[k]!=='object') cur[k]={}; cur=cur[k]; } cur[keys[keys.length-1]]=val }

function detectSimulationMarkers(j){
  const markers=[]
  const provider = (j.provider||j.gateway||j.network||'').toString().toUpperCase()
  const payoutId = j.payout_id || j.payment_id || j.paymentId || j.id
  const txId = j.tx_id || j.txId || j.transaction_id || j.transactionId
  const status = (j.status||'').toString().toLowerCase()

  if (provider==='SIMULATED') markers.push({kind:'provider_simulated', reason:'provider=SIMULATED'})
  if (looksSimulatedId(payoutId)) markers.push({kind:'id_simulated', reason:`id=${payoutId}`})
  if ((provider==='BANK_WIRE' || provider==='BANK' ) && (!j.provider || j.provider==='') && status==='prepared') {
    markers.push({kind:'bank_prepared_placeholder', reason:'bank wire prepared without provider ref'})
  }
  if (txId){
    if (!isHex64(txId)) markers.push({kind:'invalid_tx_format', reason:`txId=${txId}`})
  } else if (provider==='CRYPTO'){
    markers.push({kind:'missing_tx', reason:'crypto receipt without tx id'})
  }
  return markers
}

async function* walk(dir){
  const entries = await fs.readdir(dir,{withFileTypes:true})
  for (const e of entries){
    const p = path.join(dir,e.name)
    if (e.isDirectory()) { yield* walk(p) }
    else yield p
  }
}

async function processJsonFile(file, {dryRun}){
  try{
    const raw = await fs.readFile(file,'utf8')
    const j = JSON.parse(raw)
    const markers = detectSimulationMarkers(j)
    if (markers.length===0) return {file, updated:false, markers:[]} 

    const existing = Array.isArray(j.verification_markers)? j.verification_markers: []
    const kinds = new Set(existing.map(m=>m.kind))
    let added=0
    for(const m of markers){ if(!kinds.has(m.kind)){ existing.push(m); added++ } }

    // Add normalized booleans
    const simulationDetected = existing.some(m=> m.kind.includes('simulated') || m.kind==='bank_prepared_placeholder')
    const fakeTxDetected = existing.some(m=> m.kind==='invalid_tx_format')

    j.verification_markers = existing
    if (simulationDetected && j.simulation_detected!==true) j.simulation_detected = true
    if (fakeTxDetected && j.fake_txhash_detected!==true) j.fake_txhash_detected = true
    if (simulationDetected && j.real === undefined) j.real = false

    if (!dryRun){
      await fs.writeFile(file, JSON.stringify(j,null,2),'utf8')
    }
    return {file, updated: added>0 || simulationDetected || fakeTxDetected, markers: existing}
  }catch{ return {file, updated:false, markers:[], error:true} }
}

async function main(){
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const roots = [path.resolve('exports'), path.resolve('data')]
  const touched=[]
  for (const root of roots){
    if (!fss.existsSync(root)) continue
    for await (const file of walk(root)){
      if (!file.endsWith('.json')) continue
      const r = await processJsonFile(file,{dryRun})
      if (r.updated) touched.push(r)
    }
  }
  const report = {
    ok:true,
    at:new Date().toISOString(),
    dryRun,
    updated_count: touched.length,
    files: touched.map(t=>({file: path.relative(process.cwd(), t.file), markers: t.markers}))
  }
  const outDir = path.resolve('exports','reports')
  await fs.mkdir(outDir,{recursive:true})
  const outFile = path.join(outDir, `simulation_audit_report_${Date.now()}.json`)
  await fs.writeFile(outFile, JSON.stringify(report,null,2),'utf8')
  process.stdout.write(JSON.stringify({ok:true, report: path.relative(process.cwd(), outFile), updated: report.updated_count})+'\n')
}

main().catch(e=>{ process.stderr.write(JSON.stringify({ok:false, error: e?.message || String(e)})+'\n'); process.exitCode=1 })
