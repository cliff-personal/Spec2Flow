import type { RiskLevel } from './task-graph.js';

export interface ReviewPolicy {
  required?: boolean;
  reviewAgentCount?: number;
  requireHumanApproval?: boolean;
  maxAutoRepairAttempts?: number;
  maxExecutionRetries?: number;
  allowAutoCommit?: boolean;
  blockedRiskLevels?: RiskLevel[];
}
