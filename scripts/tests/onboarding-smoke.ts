import { mkdtempSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as OTPAuth from "otpauth";

function fail(message: string): never {
  throw new Error(message);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to determine free port"));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  const url = `${baseUrl}/api/health`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Daemon may still be booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  fail(`Timed out waiting for daemon health endpoint: ${url}`);
}

function stripAnsi(input: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence matching
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

function readCookieToken(setCookie: string | null, name: string): string | null {
  if (!setCookie) {
    return null;
  }
  const match = setCookie.match(new RegExp(`${name}=([a-f0-9]{64})`));
  return match?.[1] ?? null;
}

async function run(): Promise<void> {
  const rootDir = path.resolve(import.meta.dir, "../..");
  const tempDir = mkdtempSync(path.join(tmpdir(), "codepiper-onboarding-smoke-"));
  const socketPath = path.join(tempDir, "daemon.sock");
  const dbPath = path.join(tempDir, "codepiper.db");
  const httpPort = await getFreePort();
  const wsPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${httpPort}`;

  const daemon = Bun.spawn(
    [
      "bun",
      "run",
      "packages/daemon/src/main.ts",
      "--port",
      String(httpPort),
      "--socket",
      socketPath,
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        CODEPIPER_DB_PATH: dbPath,
        CODEPIPER_HTTP_PORT: String(httpPort),
        CODEPIPER_WS_PORT: String(wsPort),
      },
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const cleanup = async () => {
    try {
      if (daemon.exitCode === null) {
        daemon.kill();
        await daemon.exited;
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  try {
    await waitForHealth(baseUrl, 15_000);

    const resetPasswordProc = Bun.spawn(
      [
        "bun",
        "run",
        "packages/cli/src/main.ts",
        "auth",
        "--socket",
        socketPath,
        "reset-password",
        "--generate",
      ],
      {
        cwd: rootDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const [resetExitCode, resetStdout, resetStderr] = await Promise.all([
      resetPasswordProc.exited,
      new Response(resetPasswordProc.stdout).text(),
      new Response(resetPasswordProc.stderr).text(),
    ]);

    if (resetExitCode !== 0) {
      fail(
        `Password generation command failed (exit ${resetExitCode})\nstdout:\n${resetStdout}\nstderr:\n${resetStderr}`
      );
    }

    const resetOutput = stripAnsi(resetStdout);
    const passwordMatch = resetOutput.match(/New password:\s*(\S+)/);
    const password = passwordMatch?.[1];
    if (!password) {
      fail(`Could not parse generated password from output:\n${resetOutput}`);
    }

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const loginBody = (await loginResponse.json()) as Record<string, unknown>;

    if (loginResponse.status !== 401 || loginBody.mfaSetupRequired !== true) {
      fail(
        `Expected login to require onboarding MFA (401 + mfaSetupRequired). Got status ${loginResponse.status} body ${JSON.stringify(loginBody)}`
      );
    }

    const onboardingToken = readCookieToken(
      loginResponse.headers.get("set-cookie"),
      "codepiper_onboarding"
    );
    if (!onboardingToken) {
      fail("Missing codepiper_onboarding cookie in login response");
    }

    const mfaSetupStartedAt = Date.now();
    const mfaSetupResponse = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `codepiper_onboarding=${onboardingToken}`,
      },
    });
    const mfaSetupDurationMs = Date.now() - mfaSetupStartedAt;

    if (!mfaSetupResponse.ok) {
      const text = await mfaSetupResponse.text();
      fail(`MFA setup failed with status ${mfaSetupResponse.status}: ${text}`);
    }

    const mfaSetupBody = (await mfaSetupResponse.json()) as {
      secret?: string;
      qrDataUrl?: string | null;
    };

    if (!mfaSetupBody.secret) {
      fail(`MFA setup response missing secret: ${JSON.stringify(mfaSetupBody)}`);
    }

    if (mfaSetupDurationMs > 12_000) {
      fail(`MFA setup took too long (${mfaSetupDurationMs}ms), expected <= 12000ms`);
    }

    const totp = new OTPAuth.TOTP({
      issuer: "CodePiper",
      label: "admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(mfaSetupBody.secret),
    });
    const totpCode = totp.generate();

    const mfaVerifyResponse = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `codepiper_onboarding=${onboardingToken}`,
      },
      body: JSON.stringify({ totpCode }),
    });

    if (!mfaVerifyResponse.ok) {
      const text = await mfaVerifyResponse.text();
      fail(`MFA verify failed with status ${mfaVerifyResponse.status}: ${text}`);
    }

    const mfaVerifyBody = (await mfaVerifyResponse.json()) as { recoveryCodes?: string[] };
    if (!Array.isArray(mfaVerifyBody.recoveryCodes) || mfaVerifyBody.recoveryCodes.length !== 8) {
      fail(`Unexpected recovery code payload: ${JSON.stringify(mfaVerifyBody)}`);
    }

    const sessionToken = readCookieToken(
      mfaVerifyResponse.headers.get("set-cookie"),
      "codepiper_session"
    );
    if (!sessionToken) {
      fail("Missing codepiper_session cookie after onboarding MFA verify");
    }

    const statusResponse = await fetch(`${baseUrl}/api/auth/status`, {
      headers: {
        Cookie: `codepiper_session=${sessionToken}`,
      },
    });

    if (!statusResponse.ok) {
      fail(`Auth status check failed with status ${statusResponse.status}`);
    }

    const statusBody = (await statusResponse.json()) as {
      authenticated?: boolean;
      mfaEnabled?: boolean;
      setupRequired?: boolean;
      onboardingPending?: boolean;
    };

    if (!(statusBody.authenticated && statusBody.mfaEnabled) || statusBody.setupRequired) {
      fail(`Unexpected final auth status payload: ${JSON.stringify(statusBody)}`);
    }

    if (statusBody.onboardingPending) {
      fail(
        `Onboarding should be complete but onboardingPending=true: ${JSON.stringify(statusBody)}`
      );
    }

    console.log("[onboarding-smoke] pass");
    console.log(
      `[onboarding-smoke] mfa setup returned in ${mfaSetupDurationMs}ms; qrDataUrl=${mfaSetupBody.qrDataUrl ? "present" : "null"}`
    );
  } finally {
    await cleanup();
  }
}

run().catch(async (error) => {
  console.error("[onboarding-smoke] failed", error);
  process.exit(1);
});
