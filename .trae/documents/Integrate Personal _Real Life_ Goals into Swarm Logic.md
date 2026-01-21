## Personal Finance Goals Integration Plan

The user has explicitly stated their "Real" goals:
1.  **Basics**: New PC/Laptop, Essentials.
2.  **Freedom**: Repay Debts (Lightness).
3.  **Security**: Own Flat (Asset), Salary (Cashflow).
4.  **Peace**: "Me" time, Assess, Think.

To make the Swarm "Worthwhile," we must align its logic with these concrete targets, not just abstract "revenue."

### 1. Create `src/finance/PersonalGoalsManager.mjs`
This module will translate revenue into "Life Upgrades."
*   **Goal Tracking**: Define specific targets (e.g., `PC: $2000`, `Debt: $5000`, `Salary: $3000/mo`).
*   **Allocation Logic**: When money arrives (via `EnterpriseBankManager`), split it:
    *   **20%** -> Swarm Treasury (OpEx - already in Covenant).
    *   **40%** -> Debt/Essentials Fund (The "Burden Remover").
    *   **40%** -> Salary/Cashflow (The "Peace of Mind").
*   **Progress Reporting**: "You are 15% closer to the New Laptop."

### 2. Update `autonomous-daemon.mjs`
*   Integrate `PersonalGoalsManager` to run on every payout.
*   Update the "Relief Signal" to be specific: *"🏆 Payout Confirmed! $50 allocated to 'New PC Fund'. Only $1450 to go."*

### 3. Create `docs/PERSONAL_GOALS.json`
*   A config file where the user can set their exact numbers (so the code isn't hardcoded with guesses).
*   Example:
    ```json
    {
      "goals": [
        { "id": "pc", "name": "High-End Workstation", "target": 2500, "priority": 1 },
        { "id": "debt", "name": "Debt Clearance", "target": 5000, "priority": 2 },
        { "id": "flat", "name": "Apartment Downpayment", "target": 20000, "priority": 3 }
      ],
      "salary": { "monthly_target": 3000 }
    }
    ```

### 4. "Me Time" Protocol (Governance)
*   Update `tribal-council.mjs` to track "Owner Wellbeing."
*   If `Salary Target` is hit for the month -> **System Recommendation**: *"Target Met. Take 3 days off. We have the watch."*

### Execution Steps
1.  Create `src/finance/PersonalGoalsManager.mjs`.
2.  Create `docs/PERSONAL_GOALS.json` (Template).
3.  Wire into `autonomous-daemon.mjs`.
4.  Verify the "Relief Signal" update.
