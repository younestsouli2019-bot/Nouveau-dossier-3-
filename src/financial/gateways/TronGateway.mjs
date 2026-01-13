import fs from 'node:fs';
import path from 'node:path';
export class TronGateway {
  async generateInstructions(transactions) {
    const outDir = 'settlements/tron';
    const filename = `tron_instruction_${Date.now()}.json`;
    const filePath = path.join(process.cwd(), outDir, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = { provider: 'tron', action: 'check_incoming', items: transactions, status: 'WAITING_PROVIDER_INTEGRATION' };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return { status: 'INSTRUCTIONS_READY', filePath };
  }
  async checkIncoming({ address, minAmount = 0 }) {
    return { address, minAmount, status: 'NOT_IMPLEMENTED' };
  }
}
