export type BadgeTone = 'blue' | 'teal' | 'amber' | 'red' | 'gray' | 'accent' | 'outline';

export const executionStatus: Record<string, string> = {
  DRAFT: '待确认',
  POSTED: '已记账',
  VOIDED: '已撤销',
  CONFIRMED: '已登记采购',
  CANCELLED: '已取消',
  EXECUTED: '已执行',
  DISCARDED: '已放弃',
  ACTIVE: '待处理',
  SNOOZED: '已暂缓',
  IGNORED: '已忽略',
  RESOLVED: '条件已解除',
};

export const executionTone: Record<string, BadgeTone> = {
  DRAFT: 'amber',
  POSTED: 'teal',
  VOIDED: 'outline',
  CONFIRMED: 'teal',
  CANCELLED: 'outline',
  EXECUTED: 'teal',
  DISCARDED: 'outline',
  ACTIVE: 'amber',
  SNOOZED: 'blue',
  IGNORED: 'gray',
  RESOLVED: 'teal',
};

export const financialKind: Record<string, string> = {
  PAYMENT: '付供应商',
  REFUND: '收供应商退款',
  REIMBURSEMENT: '报销员工垫付',
  REIMBURSEMENT_RETURN: '员工退回报销款',
  OPENING: '核实的期初余额',
};

export const financialTone: Record<string, BadgeTone> = {
  PAYMENT: 'teal',
  REFUND: 'blue',
  REIMBURSEMENT: 'amber',
  REIMBURSEMENT_RETURN: 'blue',
  OPENING: 'gray',
};

export const actionKind: Record<string, string> = {
  PURCHASE_BATCH: '建立采购批次',
  RECEIPT: '登记到货',
  STOCK_IN: '入库',
  DISTRIBUTION: '领用发放',
  INVOICE_MATCH: '匹配发票',
};

export const actionIcon: Record<string, string> = {
  PURCHASE_BATCH: 'layers',
  RECEIPT: 'truck',
  STOCK_IN: 'inventory',
  DISTRIBUTION: 'distribution',
  INVOICE_MATCH: 'receipt',
};

export const exceptionTypeMeta: Record<string, { label: string; icon: string; border: string; tone: BadgeTone }> = {
  OVERDUE: { label: '到货逾期', icon: 'truck', border: 'border-l-red', tone: 'red' },
  RECEIVING: { label: '待入库或发放', icon: 'inventory', border: 'border-l-amber', tone: 'amber' },
  REFUND: { label: '待收退款', icon: 'receipt', border: 'border-l-red', tone: 'red' },
  REIMBURSEMENT: { label: '待报销垫付', icon: 'user', border: 'border-l-amber', tone: 'amber' },
  EMPLOYEE_RETURN: { label: '员工待退回', icon: 'restore', border: 'border-l-red', tone: 'red' },
  INVOICE: { label: '票据待核对', icon: 'file', border: 'border-l-blue', tone: 'blue' },
  DRAFT: { label: '草稿待确认', icon: 'clipboard', border: 'border-l-amber', tone: 'amber' },
  REPLENISHMENT: { label: '库存补货提醒', icon: 'box', border: 'border-l-blue', tone: 'blue' },
};
