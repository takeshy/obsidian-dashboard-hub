import { describe, expect, it } from "vitest";
import { dashboardIntegrationContractErrors, shouldUnregisterDashboardIntegration } from "./dashboardAiContract";

interface DashboardAiIntegration {
  protocolVersion: 1;
  id: string;
  name: string;
  listModels: () => Promise<Array<{ id: string; name: string; capabilities: { text: boolean; vaultRead: boolean; tools: boolean } }>>;
  getDefaultModel: () => Promise<string | null>;
}

function adapter(id: string): DashboardAiIntegration {
  return {
    protocolVersion: 1,
    id,
    name: id,
    listModels: async () => [{ id: "model", name: "Model", capabilities: { text: true, vaultRead: true, tools: true } }],
    getDefaultModel: async () => "model",
  };
}

describe.each(["llm-hub", "gemini-helper", "local-llm-hub"])("%s Dashboard AI contract", (id) => {
  it("provides the versioned model contract", async () => {
    const integration = adapter(id);
    expect(dashboardIntegrationContractErrors(integration)).toEqual([]);
    expect(await integration.getDefaultModel()).toBe("model");
    expect((await integration.listModels())[0].capabilities).toEqual({ text: true, vaultRead: true, tools: true });
  });
});

it("rejects legacy minimal adapters", () => {
  expect(dashboardIntegrationContractErrors({ id: "legacy", name: "Legacy" })).toContain("protocolVersion must be 1");
});

it("only unregisters the integration instance that requested cleanup", () => {
  const current = adapter("llm-hub");
  expect(shouldUnregisterDashboardIntegration(current, { id: current.id, integration: current })).toBe(true);
  expect(shouldUnregisterDashboardIntegration(current, { id: current.id, integration: adapter(current.id) })).toBe(false);
  expect(shouldUnregisterDashboardIntegration(current, { id: current.id, integration: undefined })).toBe(false);
});
