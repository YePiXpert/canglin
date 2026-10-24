import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { SettlementRow } from '@canglin/shared';
import SettlementMeter from './SettlementMeter.vue';

function row(over: Partial<SettlementRow> = {}): SettlementRow {
  return {
    documentId: 1,
    date: '2026-10-01',
    supplierId: 1,
    supplierName: '晨光文具',
    mode: 'DETAIL',
    version: 1,
    asOf: null,
    legacyPaymentStatus: 'UNPAID',
    legacyInvoiceIssued: false,
    netAmount: '1000.00',
    paid: '600.00',
    refunded: '0.00',
    netPaid: '600.00',
    payable: '400.00',
    refundDue: '0.00',
    reimbursementDue: '0.00',
    employeeReturnDue: '0.00',
    invoiceAmount: '1000.00',
    invoiceMissing: '0.00',
    invoiceExcess: '0.00',
    requests: [],
    ...over,
  };
}

describe('SettlementMeter', () => {
  it('renders payment and invoice ratios accurately', () => {
    const wrapper = mount(SettlementMeter, {
      props: { row: row() },
    });
    expect(wrapper.text()).toContain('600.00 / 1000.00 元（60%）');
    expect(wrapper.text()).toContain('1000.00 / 1000.00 元（100%）');
  });

  it('shows refund due and excess invoice warnings when applicable', () => {
    const wrapper = mount(SettlementMeter, {
      props: {
        row: row({
          netAmount: '500.00',
          netPaid: '600.00',
          refundDue: '100.00',
          invoiceAmount: '550.00',
          invoiceExcess: '50.00',
        }),
      },
    });
    expect(wrapper.text()).toContain('超付待退 100.00 元');
    expect(wrapper.text()).toContain('超额待冲减 50.00 元');
  });
});
