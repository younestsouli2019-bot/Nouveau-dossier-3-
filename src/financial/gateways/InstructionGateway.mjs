import fs from 'node:fs';
import path from 'node:path';
export class InstructionGateway {
  async create(payload, { dir = 'settlements/instructions', prefix = 'instruction' } = {}) {
    const filename = `${prefix}_${Date.now()}.json`;
    const filePath = path.join(process.cwd(), dir, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload || {}, null, 2));
    return { status: 'INSTRUCTIONS_READY', filePath };
  }
  async generate(providerId, transactions, title) {
    const payload = {
      provider: providerId,
      title: title || 'Instruction',
      transactions: Array.isArray(transactions) ? transactions : [],
      created_at: new Date().toISOString()
    };
    return this.create(payload, { dir: 'settlements/instructions', prefix: `instruction_${String(providerId || 'platform')}` });
  }
  async check(providerId) {
    const dir = path.join(process.cwd(), 'settlements', 'instructions');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.includes(`instruction_${String(providerId || '')}`)) : [];
    return { status: files.length > 0 ? 'INSTRUCTIONS_READY' : 'PENDING', provider: providerId, files_count: files.length };
  }
}
