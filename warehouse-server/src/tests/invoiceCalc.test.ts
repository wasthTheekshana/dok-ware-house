/// <reference types="jest" />
import { computeInvoiceAmounts } from '../utils/invoiceCalc';

describe('computeInvoiceAmounts', () => {
    it('returns all zeros when counts are zero', () => {
        expect(computeInvoiceAmounts(0, 0, 0, 0, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 10 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('returns all zeros when prices are zero, regardless of counts', () => {
        expect(computeInvoiceAmounts(100, 20, 5, 200, { archived: 0, retrieved: 0, emptyCarton: 0, storedMonthly: 0 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('computes subtotal as the sum of each event type at its own price', () => {
        const result = computeInvoiceAmounts(100, 20, 5, 0, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 0 }, 0.025641, 0.18);
        expect(result.subtotal).toBe(6000);
    });

    it('applies SSCL to the subtotal, then VAT to the SSCL-inclusive amount', () => {
        const result = computeInvoiceAmounts(100, 20, 5, 0, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 0 }, 0.025641, 0.18);
        expect(result.ssclAmount).toBe(153.85);
        expect(result.vatAmount).toBe(1107.69);
        expect(result.totalAmount).toBe(7261.54);
    });

    it('rounds every amount to 2 decimal places', () => {
        const result = computeInvoiceAmounts(1, 0, 0, 0, { archived: 33.33, retrieved: 0, emptyCarton: 0, storedMonthly: 0 }, 0.025641, 0.18);
        expect(Number.isInteger(result.subtotal * 100)).toBe(true);
        expect(Number.isInteger(result.ssclAmount * 100)).toBe(true);
        expect(Number.isInteger(result.vatAmount * 100)).toBe(true);
        expect(Number.isInteger(result.totalAmount * 100)).toBe(true);
    });

    it('adds storage rental into the subtotal on its own', () => {
        const result = computeInvoiceAmounts(0, 0, 0, 200, { archived: 0, retrieved: 0, emptyCarton: 0, storedMonthly: 10 }, 0.025641, 0.18);
        expect(result.subtotal).toBe(2000);
    });

    it('combines storage rental with the other three line items in the same subtotal', () => {
        const result = computeInvoiceAmounts(100, 20, 5, 200, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 10 }, 0.025641, 0.18);
        // 100*50 + 20*45 + 5*20 + 200*10 = 5000 + 900 + 100 + 2000 = 8000
        expect(result.subtotal).toBe(8000);
    });

    it('applies SSCL and VAT on top of the combined subtotal including rental', () => {
        const result = computeInvoiceAmounts(0, 0, 0, 100, { archived: 0, retrieved: 0, emptyCarton: 0, storedMonthly: 10 }, 0.025641, 0.18);
        // subtotal = 1000; ssclAmount = round2(1000*0.025641) = 25.64
        // vatAmount = round2((1000+25.64)*0.18) = round2(184.6152) = 184.62
        // totalAmount = round2(1000+25.64+184.62) = 1210.26
        expect(result.ssclAmount).toBe(25.64);
        expect(result.vatAmount).toBe(184.62);
        expect(result.totalAmount).toBe(1210.26);
    });
});
