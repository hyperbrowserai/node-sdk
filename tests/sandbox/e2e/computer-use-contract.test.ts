import { describe, expect, test, vi } from "vitest";
import { HyperbrowserError } from "../../../src/client";
import { ClaudeComputerUseService } from "../../../src/services/agents/claude-computer-use";
import { CuaService } from "../../../src/services/agents/cua";
import { GeminiComputerUseService } from "../../../src/services/agents/gemini-computer-use";

describe("computer use agent control contracts", () => {
  test("CUA forwards custom OpenAI API key and base URL", async () => {
    const service = new CuaService("test-key", "https://api.example.com", 30_000);
    const payload = { jobId: "job_123", liveUrl: null };
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.start({
      task: "go to example.com",
      useCustomApiKeys: true,
      apiKeys: {
        openai: "sk-test",
        openaiBaseUrl: "https://openai-compatible.example.com/v1",
      },
    });

    expect(requestSpy).toHaveBeenCalledWith("/task/cua", {
      method: "POST",
      body: JSON.stringify({
        task: "go to example.com",
        useCustomApiKeys: true,
        apiKeys: {
          openai: "sk-test",
          openaiBaseUrl: "https://openai-compatible.example.com/v1",
        },
      }),
    });
    expect(response).toEqual(payload);
  });

  test("Claude Computer Use forwards custom Anthropic API key and base URL", async () => {
    const service = new ClaudeComputerUseService("test-key", "https://api.example.com", 30_000);
    const payload = { jobId: "job_123", liveUrl: null };
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.start({
      task: "go to example.com",
      useCustomApiKeys: true,
      apiKeys: {
        anthropic: "sk-ant-test",
        anthropicBaseUrl: "https://anthropic-compatible.example.com",
      },
    });

    expect(requestSpy).toHaveBeenCalledWith("/task/claude-computer-use", {
      method: "POST",
      body: JSON.stringify({
        task: "go to example.com",
        useCustomApiKeys: true,
        apiKeys: {
          anthropic: "sk-ant-test",
          anthropicBaseUrl: "https://anthropic-compatible.example.com",
        },
      }),
    });
    expect(response).toEqual(payload);
  });

  test("Gemini Computer Use forwards custom Google API key and base URL", async () => {
    const service = new GeminiComputerUseService("test-key", "https://api.example.com", 30_000);
    const payload = { jobId: "job_123", liveUrl: null };
    const requestSpy = vi.spyOn(service as any, "request").mockResolvedValue(payload);

    const response = await service.start({
      task: "go to example.com",
      useCustomApiKeys: true,
      apiKeys: {
        google: "google-test",
        googleBaseUrl: "https://gemini-compatible.example.com",
      },
    });

    expect(requestSpy).toHaveBeenCalledWith("/task/gemini-computer-use", {
      method: "POST",
      body: JSON.stringify({
        task: "go to example.com",
        useCustomApiKeys: true,
        apiKeys: {
          google: "google-test",
          googleBaseUrl: "https://gemini-compatible.example.com",
        },
      }),
    });
    expect(response).toEqual(payload);
  });

  test("custom API key mode requires apiKeys", async () => {
    const service = new CuaService("test-key", "https://api.example.com", 30_000);

    await expect(
      service.start({
        task: "go to example.com",
        useCustomApiKeys: true,
      })
    ).rejects.toThrow(HyperbrowserError);
  });

  test("provider base URLs must be absolute http or https URLs", async () => {
    const service = new CuaService("test-key", "https://api.example.com", 30_000);

    await expect(
      service.start({
        task: "go to example.com",
        apiKeys: {
          openaiBaseUrl: "localhost:3000/v1",
        },
      })
    ).rejects.toThrow("openaiBaseUrl must be an absolute http or https URL");
  });
});
