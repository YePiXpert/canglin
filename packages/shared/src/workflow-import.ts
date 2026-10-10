import { z } from 'zod';
import { confirmedItemSchema } from './schemas.js';
import { workflowDateSchema } from './workflow.js';

/**
 * Keep physical source rows, including repeated names, when creating a request.
 * The operation id travels in the Idempotency-Key header; the supplier is chosen when a purchase is registered.
 */
export const workflowImportConfirmSchema = z.object({
  taskId: z.string().trim().min(1).max(64),
  version: z.number().int().nonnegative(),
  serialNumber: z.string().trim().min(1).max(64),
  department: z.string().trim().min(1).max(64),
  handler: z.string().trim().min(1).max(64),
  requestDate: workflowDateSchema,
  items: z.array(confirmedItemSchema.extend({ unit: z.string().trim().min(1, '请确认原件单位').max(16) })).min(1).max(500),
});
export type WorkflowImportConfirmInput = z.infer<typeof workflowImportConfirmSchema>;
