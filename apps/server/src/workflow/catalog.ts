import { NotFoundException } from '@nestjs/common';
import type { WorkflowProductCreateInput, WorkflowProductDetailsRow } from '@canglin/shared';
import type { Tx } from './workflow-records';

/** 旧名称仍指向原物品，重导历史标题不会另建一份库存。 */
export async function resolveProduct(tx: Tx, input: WorkflowProductCreateInput) {
  const identity = { name: input.itemName, specification: input.specification, unit: input.unit };
  const alias = await tx.catalogProductAlias.findUnique({ where: { name_specification_unit: identity }, include: { product: true } });
  return alias?.product ?? tx.catalogProduct.upsert({ where: { name_specification_unit: identity }, create: identity, update: {} });
}

export async function productDetails(tx: Tx, id: number): Promise<WorkflowProductDetailsRow> {
  const product = await tx.catalogProduct.findUnique({ where: { id }, include: { aliases: { orderBy: { id: 'asc' } } } });
  if (!product) throw new NotFoundException('物品不存在');
  return { id: product.id, name: product.name, specification: product.specification, unit: product.unit, version: product.catalogVersion,
    aliases: product.aliases.filter(alias => alias.name !== product.name || alias.specification !== product.specification).map(alias => ({ name: alias.name, specification: alias.specification })) };
}
