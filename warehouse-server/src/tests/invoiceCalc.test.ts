/// <reference types="jest" />
import { computeInvoiceAmounts } from '../utils/invoiceCalc';

describe('computeInvoiceAmounts', () => {
    it('returns all zeros when counts are zero', () => {
        expect(computeInvoiceAmounts(0, 0, 0, { archived: 50, retrieved: 45, emptyCarton: 20 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('returns all zeros when prices are zero, regardless of counts', () => {
        expect(computeInvoiceAmounts(100, 20, 5, { archived: 0, retrieved: 0, emptyCarton: 0 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('computes subtotal as the sum of each event type at its own price', () => {
        const result = computeInvoiceAmounts(100, 20, 5, { archived: 50, retrieved: 45, emptyCarton: 20 }, 0.025641, 0.18);
        expect(result.subtotal).toBe(6000);
    });

    it('applies SSCL to the subtotal, then VAT to the SSCL-inclusive amount', () => {
        const result = computeInvoiceAmounts(100, 20, 5, { archived: 50, retrieved: 45, emptyCarton: 20 }, 0.025641, 0.18);
        expect(result.ssclAmount).toBe(153.85);
        expect(result.vatAmount).toBe(1107.69);
        expect(result.totalAmount).toBe(7261.54);
    });

    it('rounds every amount to 2 decimal places', () => {
        const result = computeInvoiceAmounts(1, 0, 0, { archived: 33.33, retrieved: 0, emptyCarton: 0 }, 0.025641, 0.18);
        expect(Number.isInteger(result.subtotal * 100)).toBe(true);
        expect(Number.isInteger(result.ssclAmount * 100)).toBe(true);
        expect(Number.isInteger(result.vatAmount * 100)).toBe(true);
        expect(Number.isInteger(result.totalAmount * 100)).toBe(true);
    });
});
