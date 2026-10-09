/**
 * Paystack Connectivity Check — Phase 5G Step 2
 *
 * Verifies authenticated Paystack API connectivity.
 * NEVER prints credential values.
 */

import { config } from 'dotenv';
config();

const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;
const BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

interface CheckResult {
  step: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

// Step 1: Verify credentials are present
function checkCredentialsPresent(): CheckResult {
  const secretPresent = !!SECRET_KEY && SECRET_KEY !== 'sk_test_dev_placeholder' && SECRET_KEY !== 'sk_test_default';
  const publicPresent = !!PUBLIC_KEY && PUBLIC_KEY !== 'pk_test_dev_placeholder' && PUBLIC_KEY !== 'pk_test_default';
  const webhookPresent = !!WEBHOOK_SECRET && WEBHOOK_SECRET !== 'dev-webhook-secret-placeholder' && WEBHOOK_SECRET !== 'test-webhook-secret';

  const allPresent = secretPresent && publicPresent && webhookPresent;

  return {
    step: '1. Credentials Present',
    passed: allPresent,
    detail: `SECRET_KEY: ${secretPresent ? 'PRESENT (non-placeholder)' : 'MISSING or placeholder'}, ` +
            `PUBLIC_KEY: ${publicPresent ? 'PRESENT (non-placeholder)' : 'MISSING or placeholder'}, ` +
            `WEBHOOK_SECRET: ${webhookPresent ? 'PRESENT (non-placeholder)' : 'MISSING or placeholder'}`
  };
}

// Step 2: Verify secret key has test prefix
function checkTestKeyPrefix(): CheckResult {
  const isTestKey = SECRET_KEY?.startsWith('sk_test_') ?? false;
  return {
    step: '2. Test Key Prefix',
    passed: isTestKey,
    detail: isTestKey ? 'Key has sk_test_ prefix (sandbox mode)' : 'Key does NOT have sk_test_ prefix — may be a live key!'
  };
}

// Step 3: Real Paystack API call (list transaction endpoint)
async function checkApiConnectivity(): Promise<CheckResult> {
  if (!SECRET_KEY || SECRET_KEY === 'sk_test_dev_placeholder' || SECRET_KEY === 'sk_test_default') {
    return {
      step: '3. API Connectivity',
      passed: false,
      detail: 'Cannot test — secret key not available'
    };
  }

  try {
    const response = await fetch(`${BASE_URL}/transaction?perPage=1`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json() as { status?: boolean; message?: string; data?: unknown };

    if (response.status === 200 && data.status === true) {
      return {
        step: '3. API Connectivity',
        passed: true,
        detail: `Authenticated API call successful. HTTP ${response.status}.`
      };
    } else if (response.status === 401) {
      return {
        step: '3. API Connectivity',
        passed: false,
        detail: 'Authentication failed — invalid secret key (HTTP 401)'
      };
    } else {
      return {
        step: '3. API Connectivity',
        passed: false,
        detail: `Unexpected response: HTTP ${response.status}, message: ${data.message ?? 'unknown'}`
      };
    }
  } catch (error) {
    return {
      step: '3. API Connectivity',
      passed: false,
      detail: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`
    };
  }
}

// Step 4: Initialize a test transaction
async function checkInitializeTransaction(): Promise<CheckResult> {
  if (!SECRET_KEY || SECRET_KEY === 'sk_test_dev_placeholder' || SECRET_KEY === 'sk_test_default') {
    return {
      step: '4. Initialize Transaction',
      passed: false,
      detail: 'Cannot test — secret key not available'
    };
  }

  try {
    // Use Paystack's test email for successful test transactions
    const reference = `phase5g-acceptance-${Date.now()}`;
    const response = await fetch(`${BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        amount: 50000, // GHS 500.00 in pesewas
        email: 'test@example.com',
        currency: 'GHS',
        reference,
        metadata: {
          test: 'phase5g-acceptance',
          source: 'connectivity-check',
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json() as {
      status?: boolean;
      message?: string;
      data?: {
        reference?: string;
        authorization_url?: string;
        access_code?: string;
      };
    };

    if (response.status === 200 && data.status === true && data.data) {
      return {
        step: '4. Initialize Transaction',
        passed: true,
        detail: `Transaction initialized. Reference: ${data.data.reference}. ` +
                `Has auth URL: ${!!data.data.authorization_url}. ` +
                `Has access code: ${!!data.data.access_code}.`
      };
    } else {
      return {
        step: '4. Initialize Transaction',
        passed: false,
        detail: `Failed: HTTP ${response.status}, message: ${data.message ?? 'unknown'}`
      };
    }
  } catch (error) {
    return {
      step: '4. Initialize Transaction',
      passed: false,
      detail: `Error: ${error instanceof Error ? error.message : 'Unknown'}`
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Phase 5G — Paystack Sandbox Connectivity Check');
  console.log('═══════════════════════════════════════════════════════════');
  console.log();

  // Step 1-2: Sync checks
  results.push(checkCredentialsPresent());
  results.push(checkTestKeyPrefix());

  // Step 3-4: Async checks (API calls)
  results.push(await checkApiConnectivity());
  results.push(await checkInitializeTransaction());

  // Print results
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.step}`);
    console.log(`   ${result.detail}`);
    console.log();
  }

  const allPassed = results.every(r => r.passed);
  console.log('───────────────────────────────────────────────────────────');
  if (allPassed) {
    console.log('RESULT: CONNECTED — Paystack sandbox API is reachable and authenticated');
  } else {
    console.log('RESULT: BLOCKED — One or more connectivity checks failed');
    const failedSteps = results.filter(r => !r.passed).map(r => r.step);
    console.log(`Failed steps: ${failedSteps.join(', ')}`);
  }
  console.log('───────────────────────────────────────────────────────────');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
