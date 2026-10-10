import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/** Must run INSIDE the same transaction as the business operation. */
export async function operation<T>(
  tx: Prisma.TransactionClient,
  id: string,
  scope: string,
  input: unknown,
  action: () => Promise<T>,
): Promise<T> {
  const requestHash = createHash('sha256').update(canonical(input)).digest('hex');
  const prior = await tx.operationReceipt.findUnique({ where: { id } });
  if (prior) {
    if (prior.scope !== scope || prior.requestHash !== requestHash)
      throw new ConflictException('操作编号已用于不同内容，请重新发起操作');
    return JSON.parse(prior.response) as T;
  }
  const response = await action();
  await tx.operationReceipt.create({
    data: { id, scope, requestHash, response: JSON.stringify(response) },
  });
  return response;
}
