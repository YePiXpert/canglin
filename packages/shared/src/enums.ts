/** 付款状态 */
export const PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REIMBURSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: '未付款',
  PAID: '已付款',
  REIMBURSED: '已报销',
};

/** 附件类型：OA_DOC 为导入时留存的审批单原件 */
export const ATTACHMENT_KINDS = ['INVOICE', 'SIGNOFF', 'OA_DOC'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  INVOICE: '发票',
  SIGNOFF: '签收单',
  OA_DOC: 'OA 原件',
};

/** 已移除的旧台账（Item）字段中文名：仅为审计日志给旧台账留下的历史记录标注字段名而保留，新代码不得使用。 */
export const ITEM_FIELD_LABELS: Record<string, string> = {
  serialNumber: '流水号',
  department: '申领部门',
  handler: '经办人',
  requestDate: '申请日期',
  itemName: '品名',
  quantity: '数量',
  unit: '单位',
  purchaseLink: '采购链接',
  unitPrice: '单价',
  supplierId: '供应商 ID',
  supplierName: '供应商',
  status: '状态',
  invoiceIssued: '开票',
  paymentStatus: '付款状态',
  arrivalDate: '到货日期',
  distributionDate: '发放日期',
  signoffNote: '签收信息',
  note: '备注',
};
