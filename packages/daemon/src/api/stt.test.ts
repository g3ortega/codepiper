import { afterEach, describe, expect, test } from "bun:test";
import { SttNotConfiguredError, transcribeAudioFile } from "./stt";

const ORIGINAL_STT_COMMAND = process.env.CODEPIPER_STT_COMMAND;
const ORIGINAL_STT_COMMAND_JSON = process.env.CODEPIPER_STT_COMMAND_JSON;
const ORIGINAL_STT_TIMEOUT = process.env.CODEPIPER_STT_TIMEOUT_MS;

afterEach(() => {
  if (ORIGINAL_STT_COMMAND === undefined) {
    delete process.env.CODEPIPER_STT_COMMAND;
  } else {
    process.env.CODEPIPER_STT_COMMAND = ORIGINAL_STT_COMMAND;
  }

  if (ORIGINAL_STT_COMMAND_JSON === undefined) {
    delete process.env.CODEPIPER_STT_COMMAND_JSON;
  } else {
    process.env.CODEPIPER_STT_COMMAND_JSON = ORIGINAL_STT_COMMAND_JSON;
  }

  if (ORIGINAL_STT_TIMEOUT === undefined) {
    delete process.env.CODEPIPER_STT_TIMEOUT_MS;
  } else {
    process.env.CODEPIPER_STT_TIMEOUT_MS = ORIGINAL_STT_TIMEOUT;
  }
});

describe("transcribeAudioFile", () => {
  test("throws when STT backend is not configured", async () => {
    delete process.env.CODEPIPER_STT_COMMAND;
    delete process.env.CODEPIPER_STT_COMMAND_JSON;

    const file = new File(["hello"], "voice.webm", { type: "audio/webm" });

    await expect(transcribeAudioFile(file)).rejects.toBeInstanceOf(SttNotConfiguredError);
  });

  test("runs configured STT command with input placeholder", async () => {
    process.env.CODEPIPER_STT_COMMAND_JSON = JSON.stringify(["cat", "{input}"]);

    const file = new File(["hello from stt"], "voice.webm", { type: "audio/webm" });
    const result = await transcribeAudioFile(file);

    expect(result.backend).toBe("cat");
    expect(result.transcript).toBe("hello from stt");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
