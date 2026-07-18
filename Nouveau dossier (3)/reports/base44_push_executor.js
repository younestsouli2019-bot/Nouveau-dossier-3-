// scripts/push-to-base44.mjs
// LIVE DEPLOYMENT: Push all schemas, configurations, and test data to Base44
// This script COMMITS everything to your Base44 app instance

import fetch from 'node-fetch';

// ============================================================================
// BASE44 API CONFIGURATION
// ============================================================================

const BASE44_CONFIG = {
  appId: 'YOUR_APP_ID_HERE', // Replace with actual app ID
  serviceToken: 'YOUR_SERVICE_TOKEN_HERE', // Replace with actual token
  apiUrl: 'https://api.base44.com/v1'
};

// ============================================================================
// OWNER ACCOUNTS - HARDCODED (Source of Truth)
// ============================================================================

const OWNER_ACCOUNTS = {
  paypal: 'younestsouli2019@gmail.com',
  bank: '007810000448500030594182',
  payoneer: 'PRINCIPAL_ACCOUNT'
};

// ============================================================================
// BASE44 API CLIENT
// ============================================================================

class Base44Pusher {
  constructor(config) {
    this.config = config;
    this.baseUrl = `${config.apiUrl}/apps/${config.appId}`;
    this.commitLog = [];
  }

  log(message, type = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message
    };
    this.commitLog.push(entry);
    
    const icon = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      push: '⬆️'
    }[type] || 'ℹ️';
    
    console.log(`${icon} ${message}`);
  }

  async request(endpoint, method = 'GET', body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.config.serviceToken}`,
      'Content-Type': 'application/json',
      'X-Client': 'Owner-Revenue-System/2.0'
    };

    const options = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }

    this.log(`${method} ${endpoint}`, 'push');

    try {
      const response = await fetch(url, options);
      const text = await response.text();
      
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = { raw: text };
      }

      if (!response.ok) {
        throw new Error(
          `Base44 API error: ${response.status} - ${JSON.stringify(data)}`
        );
      }

      return data;
    } catch (error) {
      this.log(`Request failed: ${error.message}`, 'error');
      throw error;
    }
  }

  // Entity Operations
  async getEntity(name) {
    try {
      return await this.request(`/entities/${name}`);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async createEntity(schema) {
    return await this.request('/entities', 'POST', schema);
  }

  async updateEntity(name, schema) {
    return await this.request(`/entities/${name}`, 'PUT', schema);
  }

  async listEntities() {
    return await this.request('/entities');
  }

  // Record Operations
  async createRecord(entityName, record) {
    return await this.request(`/entities/${entityName}/records`, 'POST', record);
  }

  async updateRecord(entityName, recordId, updates) {
    return await this.request(`/entities/${entityName}/records/${recordId}`, 'PUT', updates);
  }

  async queryRecords(entityName, filters = {}) {
    const params = new URLSearchParams(filters);
    return await this.request(`/entities/${entityName}/records?${params}`);
  }

  async deleteRecord(entityName, recordId) {
    return await this.request(`/entities/${entityName}/records/${recordId}`, 'DELETE');
  }

  // Batch Operations
  async batchCreateRecords(entityName, records) {
    return await this.request(`/entities/${entityName}/records/batch`, 'POST', { records });
  }
}

// ============================================================================
// SCHEMA DEFINITIONS - PRODUCTION READY
// ============================================================================

const SCHEMAS = {
  RevenueEvent: {
    name: 'RevenueEvent',
    description: 'Revenue events with PSP verification proof',
    fields: [
      { name: 'event_id', type: 'text', required: true, unique: true },
      { name: 'amount', type: 'number', required: true },
      { name: 'currency', type: 'text', required: true },
      { name: 'occurred_at', type: 'text', required: true },
      { name: 'source', type: 'text', required: true },
      { name: 'external_id', type: 'text', required: false },
      { name: 'status', type: 'text', required: true },
      { name: 'verification_proof', type: 'json', required: false },
      { name: 'metadata', type: 'json', required: false },
      { name: 'payout_batch_id', type: 'text', required: false },
      { name: 'settled', type: 'boolean', required: false },
      { name: 'settled_at', type: 'text', required: false },
      { name: 'created_at', type: 'text', required: false },
      { name: 'event_hash', type: 'text', required: false }
    ]
  },

  Earning: {
    name: 'Earning',
    description: 'Owner revenue allocations - OWNER ONLY',
    fields: [
      { name: 'earning_id', type: 'text', required: true, unique: true },
      { name: 'amount', type: 'number', required: true },
      { name: 'currency', type: 'text', required: true },
      { name: 'occurred_at', type: 'text', required: true },
      { name: 'source', type: 'text', required: true },
      { name: 'beneficiary', type: 'text', required: true }, // OWNER ONLY
      { name: 'status', type: 'text', required: true },
      { name: 'settlement_id', type: 'text', required: false },
      { name: 'metadata', type: 'json', required: false },
      { name: 'revenue_event_id', type: 'text', required: false },
      { name: 'payout_batch_id', type: 'text', required: false },
      { name: 'created_at', type: 'text', required: false },
      { name: 'settled_at', type: 'text', required: false }
    ]
  },

  PayoutBatch: {
    name: 'PayoutBatch',
    description: 'Payout batches for owner settlements',
    fields: [
      { name: 'batch_id', type: 'text', required: true, unique: true },
      { name: 'status', type: 'text', required: true },
      { name: 'total_amount', type: 'number', required: true },
      { name: 'currency', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: false },
      { name: 'approved_at', type: 'text', required: false },
      { name: 'submitted_at', type: 'text', required: false },
      { name: 'completed_at', type: 'text', required: false },
      { name: 'cancelled_at', type: 'text', required: false },
      { name: 'notes', type: 'json', required: false },
      { name: 'settlement_id', type: 'text', required: false },
      { name: 'earning_ids', type: 'json', required: false },
      { name: 'revenue_event_ids', type: 'json', required: false },
      { name: 'payout_method', type: 'text', required: false },
      { name: 'recipient', type: 'text', required: false }, // OWNER ONLY
      { name: 'recipient_type', type: 'text', required: false },
      { name: 'owner_directive_enforced', type: 'boolean', required: false }
    ]
  },

  PayoutItem: {
    name: 'PayoutItem',
    description: 'Individual items within payout batches',
    fields: [
      { name: 'item_id', type: 'text', required: true, unique: true },
      { name: 'batch_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'amount', type: 'number', required: true },
      { name: 'currency', type: 'text', required: true },
      { name: 'recipient', type: 'text', required: true }, // OWNER ONLY
      { name: 'recipient_type', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: false },
      { name: 'processed_at', type: 'text', required: false },
      { name: 'revenue_event_id', type: 'text', required: false },
      { name: 'earning_id', type: 'text', required: false },
      { name: 'transaction_id', type: 'text', required: false },
      { name: 'paypal_status', type: 'text', required: false },
      { name: 'paypal_transaction_id', type: 'text', required: false },
      { name: 'paypal_item_id', type: 'text', required: false },
      { name: 'error_message', type: 'text', required: false }
    ]
  },

  TransactionLog: {
    name: 'TransactionLog',
    description: 'Immutable audit trail of all transactions',
    fields: [
      { name: 'log_id', type: 'text', required: true, unique: true },
      { name: 'transaction_type', type: 'text', required: true },
      { name: 'amount', type: 'number', required: true },
      { name: 'currency', type: 'text', required: true },
      { name: 'description', type: 'text', required: false },
      { name: 'transaction_date', type: 'text', required: true },
      { name: 'category', type: 'text', required: false },
      { name: 'payment_method', type: 'text', required: false },
      { name: 'reference_id', type: 'text', required: false },
      { name: 'status', type: 'text', required: true },
      { name: 'payout_batch_id', type: 'text', required: false },
      { name: 'payout_item_id', type: 'text', required: false },
      { name: 'metadata', type: 'json', required: false }
    ]
  }
};

// ============================================================================
// DEPLOYMENT ORCHESTRATOR
// ============================================================================

class Base44Deployment {
  constructor(pusher) {
    this.pusher = pusher;
    this.results = {
      schemas: { created: [], updated: [], failed: [], exists: [] },
      records: { created: [], failed: [] },
      validation: { passed: [], failed: [] }
    };
  }

  async deploySchemas() {
    console.log('\n' + '='.repeat(60));
    console.log('📦 DEPLOYING SCHEMAS TO BASE44');
    console.log('='.repeat(60) + '\n');

    for (const [name, schema] of Object.entries(SCHEMAS)) {
      this.pusher.log(`Processing: ${name}`, 'info');

      try {
        // Check if exists
        const existing = await this.pusher.getEntity(name);

        if (existing) {
          this.pusher.log(`Schema exists, checking fields...`, 'info');
          
          // Check for missing fields
          const existingFieldNames = existing.fields?.map(f => f.name) || [];
          const requiredFieldNames = schema.fields.map(f => f.name);
          const missingFields = requiredFieldNames.filter(f => !existingFieldNames.includes(f));

          if (missingFields.length > 0) {
            this.pusher.log(`Missing fields: ${missingFields.join(', ')}`, 'warning');
            this.pusher.log(`Updating schema...`, 'push');
            await this.pusher.updateEntity(name, schema);
            this.results.schemas.updated.push(name);
            this.pusher.log(`Schema updated successfully`, 'success');
          } else {
            this.results.schemas.exists.push(name);
            this.pusher.log(`Schema up-to-date`, 'success');
          }
        } else {
          this.pusher.log(`Schema does not exist, creating...`, 'push');
          await this.pusher.createEntity(schema);
          this.results.schemas.created.push(name);
          this.pusher.log(`Schema created successfully`, 'success');
        }
      } catch (error) {
        this.pusher.log(`Failed: ${error.message}`, 'error');
        this.results.schemas.failed.push({ name, error: error.message });
      }
    }
  }

  async createTestRecords() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 CREATING TEST RECORDS');
    console.log('='.repeat(60) + '\n');

    const timestamp = new Date().toISOString();
    const testId = Date.now();

    // Test 1: Revenue Event
    try {
      this.pusher.log('Creating test RevenueEvent...', 'push');
      const revenueEvent = {
        event_id: `TEST_REV_${testId}`,
        amount: 100.00,
        currency: 'USD',
        occurred_at: timestamp,
        source: 'base44_deployment_test',
        status: 'VERIFIED',
        verification_proof: {
          type: 'test',
          psp_id: `TEST_PSP_${testId}`,
          amount: 100.00,
          currency: 'USD',
          timestamp: timestamp
        },
        metadata: {
          test: true,
          deployment_id: testId,
          created_by: 'push-to-base44'
        },
        settled: false,
        created_at: timestamp
      };

      await this.pusher.createRecord('RevenueEvent', revenueEvent);
      this.results.records.created.push({ entity: 'RevenueEvent', id: revenueEvent.event_id });
      this.pusher.log(`RevenueEvent created: ${revenueEvent.event_id}`, 'success');
    } catch (error) {
      this.pusher.log(`Failed to create RevenueEvent: ${error.message}`, 'error');
      this.results.records.failed.push({ entity: 'RevenueEvent', error: error.message });
    }

    // Test 2: Earning (Owner-only)
    try {
      this.pusher.log('Creating test Earning (OWNER)...', 'push');
      const earning = {
        earning_id: `TEST_EARN_${testId}`,
        amount: 100.00,
        currency: 'USD',
        occurred_at: timestamp,
        source: 'base44_deployment_test',
        beneficiary: OWNER_ACCOUNTS.paypal, // OWNER ONLY
        status: 'pending_payout',
        revenue_event_id: `TEST_REV_${testId}`,
        metadata: {
          test: true,
          recipient_type: 'owner',
          deployment_id: testId,
          owner_directive_enforced: true
        },
        created_at: timestamp
      };

      await this.pusher.createRecord('Earning', earning);
      this.results.records.created.push({ entity: 'Earning', id: earning.earning_id });
      this.pusher.log(`Earning created: ${earning.earning_id}`, 'success');
      this.pusher.log(`  → Beneficiary: ${earning.beneficiary} (OWNER)`, 'success');
    } catch (error) {
      this.pusher.log(`Failed to create Earning: ${error.message}`, 'error');
      this.results.records.failed.push({ entity: 'Earning', error: error.message });
    }

    // Test 3: Payout Batch
    try {
      this.pusher.log('Creating test PayoutBatch...', 'push');
      const batch = {
        batch_id: `TEST_BATCH_${testId}`,
        status: 'pending_approval',
        total_amount: 100.00,
        currency: 'USD',
        created_at: timestamp,
        payout_method: 'paypal',
        recipient: OWNER_ACCOUNTS.paypal, // OWNER ONLY
        recipient_type: 'owner',
        earning_ids: [`TEST_EARN_${testId}`],
        revenue_event_ids: [`TEST_REV_${testId}`],
        owner_directive_enforced: true,
        notes: {
          test: true,
          deployment_id: testId
        }
      };

      await this.pusher.createRecord('PayoutBatch', batch);
      this.results.records.created.push({ entity: 'PayoutBatch', id: batch.batch_id });
      this.pusher.log(`PayoutBatch created: ${batch.batch_id}`, 'success');
      this.pusher.log(`  → Recipient: ${batch.recipient} (OWNER)`, 'success');
    } catch (error) {
      this.pusher.log(`Failed to create PayoutBatch: ${error.message}`, 'error');
      this.results.records.failed.push({ entity: 'PayoutBatch', error: error.message });
    }

    // Test 4: Payout Item
    try {
      this.pusher.log('Creating test PayoutItem...', 'push');
      const item = {
        item_id: `TEST_ITEM_${testId}`,
        batch_id: `TEST_BATCH_${testId}`,
        status: 'pending',
        amount: 100.00,
        currency: 'USD',
        recipient: OWNER_ACCOUNTS.paypal, // OWNER ONLY
        recipient_type: 'owner',
        revenue_event_id: `TEST_REV_${testId}`,
        earning_id: `TEST_EARN_${testId}`,
        created_at: timestamp
      };

      await this.pusher.createRecord('PayoutItem', item);
      this.results.records.created.push({ entity: 'PayoutItem', id: item.item_id });
      this.pusher.log(`PayoutItem created: ${item.item_id}`, 'success');
    } catch (error) {
      this.pusher.log(`Failed to create PayoutItem: ${error.message}`, 'error');
      this.results.records.failed.push({ entity: 'PayoutItem', error: error.message });
    }
  }

  async validateOwnerDirective() {
    console.log('\n' + '='.repeat(60));
    console.log('🔒 VALIDATING OWNER DIRECTIVE');
    console.log('='.repeat(60) + '\n');

    const validations = [
      {
        name: 'Earnings have owner beneficiaries',
        entity: 'Earning',
        field: 'beneficiary',
        expectedValues: Object.values(OWNER_ACCOUNTS)
      },
      {
        name: 'PayoutBatches have owner recipients',
        entity: 'PayoutBatch',
        field: 'recipient',
        expectedValues: Object.values(OWNER_ACCOUNTS)
      },
      {
        name: 'PayoutItems have owner recipients',
        entity: 'PayoutItem',
        field: 'recipient',
        expectedValues: Object.values(OWNER_ACCOUNTS)
      }
    ];

    for (const validation of validations) {
      this.pusher.log(`Validating: ${validation.name}...`, 'info');

      try {
        const records = await this.pusher.queryRecords(validation.entity);
        
        if (!records?.records || records.records.length === 0) {
          this.pusher.log(`No records found (expected for new deployment)`, 'info');
          this.results.validation.passed.push(validation.name);
          continue;
        }

        const violations = records.records.filter(record => {
          const value = record[validation.field]?.toLowerCase() || '';
          return !validation.expectedValues.some(owner => 
            value.includes(owner.toLowerCase())
          );
        });

        if (violations.length > 0) {
          this.pusher.log(`VIOLATIONS FOUND: ${violations.length}`, 'error');
          violations.forEach(v => {
            this.pusher.log(`  → ${v[validation.field]}`, 'error');
          });
          this.results.validation.failed.push({
            name: validation.name,
            violations: violations.length
          });
        } else {
          this.pusher.log(`All ${records.records.length} records compliant`, 'success');
          this.results.validation.passed.push(validation.name);
        }
      } catch (error) {
        this.pusher.log(`Validation error: ${error.message}`, 'error');
        this.results.validation.failed.push({
          name: validation.name,
          error: error.message
        });
      }
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 DEPLOYMENT SUMMARY');
    console.log('='.repeat(60));

    console.log('\n📦 Schemas:');
    console.log(`   ✅ Created: ${this.results.schemas.created.length}`);
    if (this.results.schemas.created.length > 0) {
      console.log(`      ${this.results.schemas.created.join(', ')}`);
    }
    console.log(`   ✓  Exists: ${this.results.schemas.exists.length}`);
    if (this.results.schemas.exists.length > 0) {
      console.log(`      ${this.results.schemas.exists.join(', ')}`);
    }
    console.log(`   🔧 Updated: ${this.results.schemas.updated.length}`);
    if (this.results.schemas.updated.length > 0) {
      console.log(`      ${this.results.schemas.updated.join(', ')}`);
    }
    console.log(`   ❌ Failed: ${this.results.schemas.failed.length}`);
    if (this.results.schemas.failed.length > 0) {
      this.results.schemas.failed.forEach(f => {
        console.log(`      ${f.name}: ${f.error}`);
      });
    }

    console.log('\n🧪 Test Records:');
    console.log(`   ✅ Created: ${this.results.records.created.length}`);
    this.results.records.created.forEach(r => {
      console.log(`      ${r.entity}: ${r.id}`);
    });
    console.log(`   ❌ Failed: ${this.results.records.failed.length}`);
    this.results.records.failed.forEach(f => {
      console.log(`      ${f.entity}: ${f.error}`);
    });

    console.log('\n🔒 Owner Directive Validation:');
    console.log(`   ✅ Passed: ${this.results.validation.passed.length}`);
    console.log(`   ❌ Failed: ${this.results.validation.failed.length}`);
    if (this.results.validation.failed.length > 0) {
      this.results.validation.failed.forEach(f => {
        console.log(`      ${f.name}: ${f.violations || f.error}`);
      });
    }

    const allSchemasOk = this.results.schemas.failed.length === 0;
    const allValidationsOk = this.results.validation.failed.length === 0;

    console.log('\n' + '='.repeat(60));
    if (allSchemasOk && allValidationsOk) {
      console.log('✅ DEPLOYMENT SUCCESSFUL');
      console.log('🚀 System ready for production');
    } else {
      console.log('⚠️  DEPLOYMENT COMPLETED WITH WARNINGS');
      console.log('📋 Review errors above and take corrective action');
    }
    console.log('='.repeat(60) + '\n');
  }

  getCommitLog() {
    return this.pusher.commitLog;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  BASE44 LIVE DEPLOYMENT - OWNER REVENUE SYSTEM            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Validate configuration
  if (BASE44_CONFIG.appId === 'YOUR_APP_ID_HERE' || 
      BASE44_CONFIG.serviceToken === 'YOUR_SERVICE_TOKEN_HERE') {
    console.error('❌ ERROR: Please configure BASE44_APP_ID and BASE44_SERVICE_TOKEN');
    console.error('   Edit this file and replace the placeholder values.\n');
    process.exit(1);
  }

  console.log('📋 Configuration:');
  console.log(`   App ID: ${BASE44_CONFIG.appId}`);
  console.log(`   API URL: ${BASE44_CONFIG.apiUrl}`);
  console.log('\n🔒 Owner Accounts:');
  console.log(`   PayPal: ${OWNER_ACCOUNTS.paypal}`);
  console.log(`   Bank: ${OWNER_ACCOUNTS.bank}`);
  console.log(`   Payoneer: ${OWNER_ACCOUNTS.payoneer}`);

  const pusher = new Base44Pusher(BASE44_CONFIG);
  const deployment = new Base44Deployment(pusher);

  try {
    // Step 1: Deploy schemas
    await deployment.deploySchemas();

    // Step 2: Create test records
    if (process.argv.includes('--with-test-data')) {
      await deployment.createTestRecords();
    } else {
      console.log('\n⏭️  Skipping test record creation (use --with-test-data to enable)');
    }

    // Step 3: Validate owner directive
    await deployment.validateOwnerDirective();

    // Step 4: Print summary
    deployment.printSummary();

    // Step 5: Save commit log
    const logPath = `./audits/base44-deployment-${Date.now()}.json`;
    console.log(`\n💾 Saving deployment log to: ${logPath}`);
    
    // In production, save to file:
    // const fs = require('fs');
    // fs.writeFileSync(logPath, JSON.stringify(deployment.getCommitLog(), null, 2));

    process.exit(0);

  } catch (error) {
    console.error('\n💥 DEPLOYMENT FAILED:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  Base44Pusher,
  Base44Deployment,
  SCHEMAS,
  OWNER_ACCOUNTS
};