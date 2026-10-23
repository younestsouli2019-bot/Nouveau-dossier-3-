import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AUTHORIZED_CARRIERS,
  POD_REF_RX,
  PoDeliveryFailClosed,
  sha256Hex,
  normalizeCarrier,
  isSyntheticProof,
  assertPodRef,
  assertCarrier,
  assertRealTracking,
  computeReceiptPod,
  loadCarrierTracking,
  assessPo,
  planDelivery,
  deliverOwnerPos,
} from './lib/po-delivery.mjs';

const HEX64 = 'a'.repeat(64);
const HEX64B = 'b'.repeat(64);
const REAL_TRACKING = 'EE123456789MA';

let tmpDir;

/** Assert a synchronous guard call fail-closes with the expected code. */
function expectFailClosed(fn, code) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(PoDeliveryFailClosed);
  expect(err.code).toBe(code);
  return err;
}

function writeScan(dir, name, content = 'signed carrier delivery note (NG2 P.166)') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-delivery-'));
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('po-delivery guard — fail-closed evidence (NG2)', () => {
  it('authorises exactly the 8 Moroccan carriers', () => {
    expect(AUTHORIZED_CARRIERS).toHaveLength(8);
    for (const c of ['AMANA', 'FORCELOG', 'CHRONO_DIALI', 'CATHEDIS', 'ARAMEX', 'DHL', 'FEDEX', 'UPS']) {
      expect(AUTHORIZED_CARRIERS).toContain(c);
    }
  });

  describe('isSyntheticProof', () => {
    it('treats empty / null as synthetic', () => {
      expect(isSyntheticProof('')).toBe(true);
      expect(isSyntheticProof(null)).toBe(true);
      expect(isSyntheticProof(undefined)).toBe(true);
    });

    it('treats a bare 64-hex digest (no carrier anchor) as synthetic', () => {
      expect(isSyntheticProof(HEX64)).toBe(true);
      expect(isSyntheticProof(HEX64B.toUpperCase())).toBe(true);
    });

    it('accepts a carrier-anchored POD reference', () => {
      expect(isSyntheticProof(`POD:AMANA:${HEX64}`)).toBe(false);
    });
  });

  describe('assertPodRef', () => {
    it('accepts canonical references', () => {
      expect(assertPodRef(`POD:ARAMEX:${HEX64}`)).toBe(`POD:ARAMEX:${HEX64}`);
    });

    it('rejects a synthetic digest', () => {
      expectFailClosed(() => assertPodRef(HEX64), 'PO_GUARD_SYNTHETIC_PROOF');
    });

    it('rejects an unauthorised carrier in the reference', () => {
      expectFailClosed(() => assertPodRef(`POD:LA_POSTE:${HEX64}`), 'PO_GUARD_BAD_POD_REF');
    });

    it('rejects a truncated digest', () => {
      expectFailClosed(() => assertPodRef('POD:DHL:deadbeef'), 'PO_GUARD_BAD_POD_REF');
    });
  });

  describe('normalizeCarrier / assertCarrier', () => {
    it('collapses real-world carrier labels to canonical codes', () => {
      expect(normalizeCarrier('amana-cod')).toBe('AMANA');
      expect(normalizeCarrier('Aramex Morocco')).toBe('ARAMEX');
      expect(normalizeCarrier('chrono diali')).toBe('CHRONO_DIALI');
      expect(normalizeCarrier('')).toBeNull();
    });

    it('refuses carriers outside the authorised 8', () => {
      expect(assertCarrier('AMANA', 'SWARM-PO-2026-001')).toBe('AMANA');
      expectFailClosed(() => assertCarrier('La Poste', 'SWARM-PO-2026-001'), 'PO_GUARD_BAD_CARRIER');
    });
  });

  describe('assertRealTracking', () => {
    it('accepts a real carrier reference', () => {
      expect(assertRealTracking({ carrier: 'amana', trackingNumber: REAL_TRACKING, poRef: 'P' }))
        .toEqual({ carrier: 'AMANA', trackingNumber: REAL_TRACKING });
    });

    it('refuses absent, short or placeholder references', () => {
      expectFailClosed(() => assertRealTracking({ carrier: 'AMANA', trackingNumber: '', poRef: 'P' }), 'PO_GUARD_NO_TRACKING');
      expectFailClosed(() => assertRealTracking({ carrier: 'AMANA', trackingNumber: 'abc', poRef: 'P' }), 'PO_GUARD_NO_TRACKING');
      expectFailClosed(() => assertRealTracking({ carrier: 'AMANA', trackingNumber: 'unknown', poRef: 'P' }), 'PO_GUARD_NO_TRACKING');
      expectFailClosed(() => assertRealTracking({ carrier: 'AMANA', trackingNumber: 'test', poRef: 'P' }), 'PO_GUARD_NO_TRACKING');
    });
  });

  describe('computeReceiptPod', () => {
    it('fail-closes when the receipt directory does not exist', () => {
      expectFailClosed(
        () => computeReceiptPod({ receivedDir: path.join(tmpDir, 'nope'), poRef: 'SWARM-PO-2026-001', carrier: 'AMANA' }),
        'PO_GUARD_NO_RECEIVED_DIR',
      );
    });

    it('fail-closes when no signed scan is present (never synthesises one)', () => {
      expectFailClosed(
        () => computeReceiptPod({ receivedDir: tmpDir, poRef: 'SWARM-PO-2026-001', carrier: 'AMANA' }),
        'PO_GUARD_NO_RECEIPT_SCAN',
      );
    });

    it('derives the POD from the sha256 of a real on-disk scan', () => {
      const content = 'physical signed delivery note';
      writeScan(tmpDir, 'SWARM-PO-2026-001-AMANA.pdf', content);
      const pod = computeReceiptPod({ receivedDir: tmpDir, poRef: 'SWARM-PO-2026-001', carrier: 'AMANA' });
      expect(pod.carrier).toBe('AMANA');
      expect(pod.sha256).toBe(sha256Hex(content));
      expect(pod.podRef).toBe(`POD:AMANA:${sha256Hex(content)}`);
      expect(POD_REF_RX.test(pod.podRef)).toBe(true);
    });

    it('ignores non-scan files when picking the receipt', () => {
      writeScan(tmpDir, 'notes.txt', 'not a scan');
      expectFailClosed(
        () => computeReceiptPod({ receivedDir: tmpDir, poRef: 'SWARM-PO-2026-001', carrier: 'AMANA' }),
        'PO_GUARD_NO_RECEIPT_SCAN',
      );
    });
  });

  describe('loadCarrierTracking', () => {
    it('fail-closes when the tracking file is absent', () => {
      expectFailClosed(() => loadCarrierTracking(path.join(tmpDir, 'missing.json')), 'PO_GUARD_NO_TRACKING_FILE');
    });

    it('fail-closes on malformed JSON', () => {
      const p = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(p, '{ not json');
      expectFailClosed(() => loadCarrierTracking(p), 'PO_GUARD_BAD_TRACKING_FILE');
    });

    it('fail-closes when the payload is not a PO-keyed object', () => {
      const p = path.join(tmpDir, 'arr.json');
      fs.writeFileSync(p, '[]');
      expectFailClosed(() => loadCarrierTracking(p), 'PO_GUARD_BAD_TRACKING_FILE');
    });

    it('loads a PO-keyed tracking object', () => {
      const p = path.join(tmpDir, 'ok.json');
      fs.writeFileSync(p, JSON.stringify({ 'SWARM-PO-2026-001': { carrier: 'AMANA', trackingNumber: REAL_TRACKING } }));
      expect(loadCarrierTracking(p)['SWARM-PO-2026-001'].trackingNumber).toBe(REAL_TRACKING);
    });
  });

  describe('assessPo / planDelivery', () => {
    const po = { poRef: 'SWARM-PO-2026-001', carrier: 'AMANA', recipientName: 'Test', city: 'Casablanca' };

    it('blocks a PO with no external tracking (no invented numbers)', () => {
      const a = assessPo({ po, trackingEntry: undefined, receivedDir: tmpDir });
      expect(a.status).toBeNull();
      expect(a.trackingNumber).toBeNull();
      expect(a.pod).toBeNull();
    });

    it('blocks a PO whose tracking number is a placeholder', () => {
      const a = assessPo({ po, trackingEntry: { carrier: 'AMANA', trackingNumber: 'TBD' }, receivedDir: tmpDir });
      expect(a.status).toBeNull();
    });

    it('records label_created when tracking exists but no carrier events yet', () => {
      const a = assessPo({ po, trackingEntry: { carrier: 'amana', trackingNumber: REAL_TRACKING, events: [] }, receivedDir: tmpDir });
      expect(a.status).toBe('label_created');
      expect(a.carrier).toBe('AMANA');
      expect(a.pod).toBeNull();
    });

    it('records in_transit when real carrier events exist', () => {
      const a = assessPo({
        po,
        trackingEntry: { carrier: 'AMANA', trackingNumber: REAL_TRACKING, events: [{ status: 'in_transit', location: 'Rabat' }] },
        receivedDir: tmpDir,
      });
      expect(a.status).toBe('in_transit');
      expect(a.pod).toBeNull();
    });

    it('marks delivered only when a signed scan exists', () => {
      writeScan(tmpDir, 'SWARM-PO-2026-001-AMANA.jpg');
      const a = assessPo({
        po,
        trackingEntry: { carrier: 'AMANA', trackingNumber: REAL_TRACKING, events: [{ status: 'in_transit' }] },
        receivedDir: tmpDir,
      });
      expect(a.status).toBe('delivered');
      expect(a.pod.podRef).toMatch(POD_REF_RX);
    });

    it('splits POs into ready vs blocked', () => {
      const pos = [po, { poRef: 'SWARM-PO-2026-002', carrier: 'ARAMEX', recipientName: 'N', city: 'Rabat' }];
      const { ready, blocked } = planDelivery({
        pos,
        tracking: { 'SWARM-PO-2026-001': { carrier: 'AMANA', trackingNumber: REAL_TRACKING, events: [{ status: 'in_transit' }] } },
        receivedDir: tmpDir,
      });
      expect(ready.map((r) => r.po.poRef)).toEqual(['SWARM-PO-2026-001']);
      expect(blocked.map((b) => b.po.poRef)).toEqual(['SWARM-PO-2026-002']);
    });
  });

  describe('deliverOwnerPos', () => {
    const po = { poRef: 'SWARM-PO-2026-001', carrier: 'AMANA', recipientName: 'Test', recipientAddress: 'A', city: 'Casablanca', country: 'Morocco', items: ['TV', 'Soundbar'] };

    function fakeDb() {
      return {
        calls: [],
        async query(sql, params) {
          this.calls.push({ sql, params });
        },
      };
    }

    it('requires a database client', async () => {
      await expect(deliverOwnerPos({ db: null, pos: [po], tracking: {}, receivedDir: tmpDir }))
        .rejects.toMatchObject({ code: 'PO_GUARD_NO_DB' });
    });

    it('records nothing when no PO has real evidence', async () => {
      const db = fakeDb();
      const res = await deliverOwnerPos({ db, pos: [po], tracking: {}, receivedDir: tmpDir });
      expect(db.calls).toHaveLength(0);
      expect(res.delivered).toHaveLength(0);
      expect(res.blocked).toHaveLength(1);
    });

    it('writes trackingVerified=false and actualDelivery=null without real proof', async () => {
      const db = fakeDb();
      await deliverOwnerPos({
        db,
        pos: [po],
        tracking: { 'SWARM-PO-2026-001': { carrier: 'AMANA', trackingNumber: REAL_TRACKING, events: [] } },
        receivedDir: tmpDir,
      });
      const shipment = db.calls.find((c) => /INSERT INTO "Shipment"/.test(c.sql));
      expect(shipment).toBeTruthy();
      expect(shipment.params[7]).toBe(false); // trackingVerified
      expect(shipment.params[8]).toBeNull(); // actualDelivery
      expect(shipment.params[5]).toBe('label_created');
      const audit = db.calls.find((c) => /INSERT INTO "AuditLedger"/.test(c.sql));
      expect(audit.params[4]).toBeNull(); // proofHash — no POD
    });

    it('writes trackingVerified=true and a POD proofHash only with real evidence', async () => {
      writeScan(tmpDir, 'SWARM-PO-2026-001-AMANA.pdf');
      const db = fakeDb();
      const res = await deliverOwnerPos({
        db,
        pos: [po],
        tracking: { 'SWARM-PO-2026-001': { carrier: 'AMANA', trackingNumber: REAL_TRACKING, events: [{ status: 'in_transit' }] } },
        receivedDir: tmpDir,
      });
      const shipment = db.calls.find((c) => /INSERT INTO "Shipment"/.test(c.sql));
      expect(shipment.params[7]).toBe(true); // trackingVerified
      expect(shipment.params[8]).toBeInstanceOf(Date); // actualDelivery
      expect(shipment.params[5]).toBe('delivered');
      const audit = db.calls.find((c) => /INSERT INTO "AuditLedger"/.test(c.sql));
      expect(audit.params[4]).toMatch(POD_REF_RX); // proofHash
      expect(res.delivered[0].podRef).toMatch(POD_REF_RX);
    });
  });
});
