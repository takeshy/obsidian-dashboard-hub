export interface VersionedDashboardIntegration {
  protocolVersion?: number;
  id?: string;
  name?: string;
  listModels?: unknown;
  getDefaultModel?: unknown;
}

export interface DashboardIntegrationUnregisterRequest {
  id?: string;
  integration: unknown;
}

export function shouldUnregisterDashboardIntegration(
  current: unknown,
  request: DashboardIntegrationUnregisterRequest,
): boolean {
  return Boolean(request.id && current && request.integration && current === request.integration);
}

export function dashboardIntegrationContractErrors(integration: VersionedDashboardIntegration): string[] {
  const errors: string[] = [];
  if (integration.protocolVersion !== 1) errors.push("protocolVersion must be 1");
  if (!integration.id) errors.push("id is required");
  if (!integration.name) errors.push("name is required");
  if (typeof integration.listModels !== "function") errors.push("listModels is required");
  if (typeof integration.getDefaultModel !== "function") errors.push("getDefaultModel is required");
  return errors;
}
