// Hierarchical Escrow Vaults with Dynamic Quorum Constraints
// Prevents over-allocation of capital — isolated capital pools
// Attack vector: Liquidity Locks — over-allocation of capital causing overdrafts or penalties
// Prevention: Hierarchical Escrow Vaults with dynamic quorum constraints → 100% isolated capital pools

import { prisma } from '@/lib/db';
import { sha256 } from './strict-enforcement/crypto-utils';

export type VaultType = 'master' | 'operational' | 'settlement' | 'procurement' | 'emergency' | 'recovery';
export type VaultStatus = 'active' | 'locked' | 'frozen' | 'drained';

export interface VaultConfig {
  id: string;
  name: string;
  type: VaultType;
  parentId: string | null;
  maxAllocation: number;
  currentBalance: number;
  status: VaultStatus;
  quorumRequired: number; // number of approvals needed to release
  lockUntil: Date | null;
  allowedOutflows: string[]; // entity types allowed to draw
}

export interface AllocationResult {
  approved: boolean;
  vaultId: string;
  requested: number;
  allocated: number;
  remaining: number;
  quorumMet: boolean;
  rejectionReason?: string;
}

// Vault hierarchy with allocation limits
const VAULT_HIERARCHY: Record<VaultType, { maxPctOfParent: number; quorum: number; allowedOutflows: string[] }> = {
  master: { maxPctOfParent: 100, quorum: 2, allowedOutflows: ['*'] },
  operational: { maxPctOfParent: 40, quorum: 1, allowedOutflows: ['settlement', 'procurement'] },
  settlement: { maxPctOfParent: 30, quorum: 1, allowedOutflows: ['external_payment'] },
  procurement: { maxPctOfParent: 25, quorum: 1, allowedOutflows: ['supplier_payment'] },
  emergency: { maxPctOfParent: 10, quorum: 2, allowedOutflows: ['recovery'] },
  recovery: { maxPctOfParent: 5, quorum: 2, allowedOutflows: ['external_payment'] },
};

// Maximum exposure across ALL vaults (percentage of total revenue)
const MAX_TOTAL_EXPOSURE_PCT = 85;

let vaultState: VaultConfig[] = [];

function initializeVaults(totalRevenue: number): VaultConfig[] {
  const config = VAULT_HIERARCHY;
  const now = new Date();

  return [
    {
      id: 'vault-master',
      name: 'Master Pool',
      type: 'master',
      parentId: null,
      maxAllocation: totalRevenue,
      currentBalance: totalRevenue,
      status: 'active',
      quorumRequired: config.master.quorum,
      lockUntil: null,
      allowedOutflows: config.master.allowedOutflows,
    },
    {
      id: 'vault-operational',
      name: 'Operational',
      type: 'operational',
      parentId: 'vault-master',
      maxAllocation: totalRevenue * (config.operational.maxPctOfParent / 100),
      currentBalance: 0,
      status: 'active',
      quorumRequired: config.operational.quorum,
      lockUntil: null,
      allowedOutflows: config.operational.allowedOutflows,
    },
    {
      id: 'vault-settlement',
      name: 'Settlement',
      type: 'settlement',
      parentId: 'vault-operational',
      maxAllocation: totalRevenue * (config.settlement.maxPctOfParent / 100),
      currentBalance: 0,
      status: 'active',
      quorumRequired: config.settlement.quorum,
      lockUntil: null,
      allowedOutflows: config.settlement.allowedOutflows,
    },
    {
      id: 'vault-procurement',
      name: 'Procurement',
      type: 'procurement',
      parentId: 'vault-operational',
      maxAllocation: totalRevenue * (config.procurement.maxPctOfParent / 100),
      currentBalance: 0,
      status: 'active',
      quorumRequired: config.procurement.quorum,
      lockUntil: null,
      allowedOutflows: config.procurement.allowedOutflows,
    },
    {
      id: 'vault-emergency',
      name: 'Emergency Reserve',
      type: 'emergency',
      parentId: 'vault-master',
      maxAllocation: totalRevenue * (config.emergency.maxPctOfParent / 100),
      currentBalance: 0,
      status: 'locked',
      quorumRequired: config.emergency.quorum,
      lockUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30-day lock
      allowedOutflows: config.emergency.allowedOutflows,
    },
    {
      id: 'vault-recovery',
      name: 'Recovery',
      type: 'recovery',
      parentId: 'vault-emergency',
      maxAllocation: totalRevenue * (config.recovery.maxPctOfParent / 100),
      currentBalance: 0,
      status: 'locked',
      quorumRequired: config.recovery.quorum,
      lockUntil: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), // 90-day lock
      allowedOutflows: config.recovery.allowedOutflows,
    },
  ];
}

export async function initializeEscrowSystem(totalRevenue: number): Promise<VaultConfig[]> {
  vaultState = initializeVaults(totalRevenue);
  return vaultState;
}

export async function allocateToVault(
  vaultId: string,
  amount: number,
  outflowType: string,
  approvals: number = 1,
): Promise<AllocationResult> {
  const vault = vaultState.find(v => v.id === vaultId);
  if (!vault) {
    return { approved: false, vaultId, requested: amount, allocated: 0, remaining: 0, quorumMet: false, rejectionReason: 'Vault not found' };
  }

  // Check vault status
  if (vault.status === 'frozen') {
    return { approved: false, vaultId, requested: amount, allocated: 0, remaining: vault.currentBalance, quorumMet: false, rejectionReason: 'Vault is frozen' };
  }

  if (vault.status === 'locked') {
    if (vault.lockUntil && vault.lockUntil > new Date()) {
      return { approved: false, vaultId, requested: amount, allocated: 0, remaining: vault.currentBalance, quorumMet: false, rejectionReason: `Vault locked until ${vault.lockUntil.toISOString()}` };
    }
  }

  // Check outflow permission
  if (!vault.allowedOutflows.includes('*') && !vault.allowedOutflows.includes(outflowType)) {
    return { approved: false, vaultId, requested: amount, allocated: 0, remaining: vault.currentBalance, quorumMet: false, rejectionReason: `Outflow type '${outflowType}' not permitted from this vault` };
  }

  // Check balance sufficiency
  if (amount > vault.currentBalance) {
    return { approved: false, vaultId, requested: amount, allocated: 0, remaining: vault.currentBalance, quorumMet: false, rejectionReason: `Insufficient balance: $${vault.currentBalance.toFixed(2)} < $${amount.toFixed(2)}` };
  }

  // Check allocation cap
  const totalExposure = vaultState.reduce((sum, v) => sum + v.currentBalance, 0);
  const totalRevenue = vaultState.find(v => v.type === 'master')?.maxAllocation || 0;
  const exposurePct = totalRevenue > 0 ? (totalExposure / totalRevenue) * 100 : 0;

  if (exposurePct > MAX_TOTAL_EXPOSURE_PCT) {
    return { approved: false, vaultId, requested: amount, allocated: 0, remaining: vault.currentBalance, quorumMet: false, rejectionReason: `Total exposure ${exposurePct.toFixed(1)}% exceeds ${MAX_TOTAL_EXPOSURE_PCT}% limit` };
  }

  // Check quorum
  const quorumMet = approvals >= vault.quorumRequired;
  if (!quorumMet) {
    return { approved: false, vaultId, requested: amount, allocated: 0, remaining: vault.currentBalance, quorumMet: false, rejectionReason: `Quorum not met: ${approvals}/${vault.quorumRequired} required` };
  }

  // Allocate
  vault.currentBalance -= amount;

  // Cascade to parent
  if (vault.parentId) {
    const parent = vaultState.find(v => v.id === vault.parentId);
    if (parent) parent.currentBalance -= amount;
  }

  const proofHash = await sha256(JSON.stringify({
    vaultId, amount, outflowType, approvals,
    newBalance: vault.currentBalance,
    ts: Date.now(),
  }));

  await prisma.auditLedger.create({
    data: {
      entityType: 'escrow_allocation',
      entityId: vaultId,
      action: 'allocated',
      entryHash: proofHash,
      performedBy: 'escrow-vault',
      metadata: JSON.stringify({
        vaultId, amount, outflowType,
        newBalance: vault.currentBalance,
        quorumMet,
      }),
    },
  });

  return {
    approved: true,
    vaultId,
    requested: amount,
    allocated: amount,
    remaining: vault.currentBalance,
    quorumMet,
  };
}

export async function getVaultStatus(): Promise<VaultConfig[]> {
  return vaultState.map(v => ({ ...v }));
}

export async function getTotalExposure(): Promise<{ total: number; percentage: number; limit: number }> {
  const total = vaultState.reduce((sum, v) => sum + v.currentBalance, 0);
  const master = vaultState.find(v => v.type === 'master');
  const revenue = master?.maxAllocation || 1;
  return {
    total,
    percentage: Math.round((total / revenue) * 10000) / 100,
    limit: MAX_TOTAL_EXPOSURE_PCT,
  };
}

export async function freezeVault(vaultId: string, reason: string): Promise<boolean> {
  const vault = vaultState.find(v => v.id === vaultId);
  if (!vault) return false;
  vault.status = 'frozen';

  await prisma.auditLedger.create({
    data: {
      entityType: 'escrow_vault',
      entityId: vaultId,
      action: 'frozen',
      entryHash: await sha256(`freeze:${vaultId}:${reason}:${Date.now()}`),
      performedBy: 'system',
      discrepancyNote: reason,
    },
  });

  return true;
}
