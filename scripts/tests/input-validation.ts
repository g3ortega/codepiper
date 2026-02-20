/**
 * Test input validation - Verify 400 errors for invalid input
 */

const SOCKET_PATH = "/tmp/codepiper.sock";

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    unix: SOCKET_PATH,
    ...options,
  });
}

interface TestCase {
  name: string;
  endpoint: string;
  method: string;
  body: any;
  expectedStatus: number;
  expectedError: string;
}

async function runTest(test: TestCase): Promise<boolean> {
  console.log(`  Testing: ${test.name}`);

  const response = await apiRequest(test.endpoint, {
    method: test.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(test.body),
  });

  const data = await response.json();

  if (response.status !== test.expectedStatus) {
    console.log(`    ❌ FAIL - Expected ${test.expectedStatus}, got ${response.status}`);
    console.log(`       Response: ${JSON.stringify(data)}`);
    return false;
  }

  if (data.error && !data.error.includes(test.expectedError)) {
    console.log(`    ⚠️  WARNING - Error message mismatch`);
    console.log(`       Expected: "${test.expectedError}"`);
    console.log(`       Got: "${data.error}"`);
  }

  console.log(`    ✅ PASS - ${response.status} ${data.error || "OK"}`);
  return true;
}

async function main() {
  console.log("🔍 Input Validation Test\n");

  const tests: TestCase[] = [
    // Test 1: Extremely long cwd
    {
      name: "Extremely long cwd (100k chars)",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "claude-code",
        cwd: `/${"a".repeat(100000)}`,
      },
      expectedStatus: 400,
      expectedError: "cwd path too long",
    },

    // Test 2: Non-absolute path
    {
      name: "Relative path (not absolute)",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "claude-code",
        cwd: "relative/path",
      },
      expectedStatus: 400,
      expectedError: "must be an absolute path",
    },

    // Test 3: Null byte in path
    {
      name: "Null byte in cwd",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "claude-code",
        cwd: "/tmp\0/malicious",
      },
      expectedStatus: 400,
      expectedError: "invalid null byte",
    },

    // Test 4: Invalid provider
    {
      name: "Invalid provider",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "invalid-provider",
        cwd: "/tmp",
      },
      expectedStatus: 400,
      expectedError: "Invalid provider",
    },

    // Test 5: Missing required field
    {
      name: "Missing cwd field",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "claude-code",
      },
      expectedStatus: 400,
      expectedError: "Missing required field: cwd",
    },

    // Test 6: Invalid env (array instead of object)
    {
      name: "Invalid env (array)",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "claude-code",
        cwd: "/tmp",
        env: ["not", "an", "object"],
      },
      expectedStatus: 400,
      expectedError: "env must be an object",
    },

    // Test 7: Too many env vars
    {
      name: "Too many env vars (>1000)",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "claude-code",
        cwd: "/tmp",
        env: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`VAR_${i}`, `value${i}`])),
      },
      expectedStatus: 400,
      expectedError: "too many environment variables",
    },

    // Test 8: Invalid args (not array)
    {
      name: "Invalid args (not array)",
      endpoint: "/sessions",
      method: "POST",
      body: {
        provider: "claude-code",
        cwd: "/tmp",
        args: "not-an-array",
      },
      expectedStatus: 400,
      expectedError: "args must be an array",
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await runTest(test);
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📋 Total: ${tests.length}`);

  if (failed === 0) {
    console.log("\n🎉 All validation tests passed!");
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
