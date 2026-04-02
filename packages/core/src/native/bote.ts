/**
 * Bote stub — the native NAPI MCP registry module is gone.
 * All functions are no-ops or return null. The consumer (mcp/client.ts)
 * uses bote only for mirroring tool registrations — null return is handled.
 */

export function registerTool(_tool: {
  name: string;
  description?: string;
  input_schema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}): void {}

export function listTools(): string {
  return '[]';
}

export function getTool(_name: string): string | null {
  return null;
}

export function validateParams(_toolName: string, _paramsJson: string): string {
  return '{"valid":true}';
}

export function removeTool(_name: string): boolean {
  return false;
}

export function toolCount(): number {
  return 0;
}

export function parseJsonrpc(_requestJson: string): string {
  return '{}';
}

export function jsonrpcSuccess(_id: string, _resultJson: string): string {
  return '{}';
}

export function jsonrpcError(_id: string, _code: number, _message: string): string {
  return '{}';
}
