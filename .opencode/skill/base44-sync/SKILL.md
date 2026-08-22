---
name: base44-sync
description: Use when syncing data to Base44 App, creating Mission entities, managing RevenueEvents, or working with the Base44 SDK. Trigger on keywords: base44, sync, mission, revenue, entity, sdk.
---

# Base44 Sync Skill

## Purpose
Synchronize procurement data, financial records, and mission status with the Base44 App.

## Connection Details
- App ID: 6888ac155ebf84dd9855ea98
- API URL: https://api.base44.app/v1
- SDK: @base44/sdk (installed locally)
- Service Token: 5b4be0fada884ca28142a3279e9880f6

## Available Entities
- Mission - Procurement missions and their status
- RevenueEvent - Financial transactions
- PayoutBatch - Batch payout tracking
- PayoutItem - Individual payout items
- Agent - Agent registrations
- SwarmCoordination - Swarm state tracking
- Campaign - Campaign tracking

## Write Access
- Service role can READ all entities
- Write access requires functions.invoke() (402 - needs subscription)
- Alternative: Use GitHub Actions to push data via API

## Sync Workflow
1. Read local data (procurement-requests.json, owner_bank_requests.csv)
2. Transform to Base44 entity format
3. Create/update entities via SDK or API
4. Verify sync status
5. Log results to exports/reports/

## Offline Store
- Local cache: .base44-offline-store.json
- Contains RevenueEvent records for offline access
