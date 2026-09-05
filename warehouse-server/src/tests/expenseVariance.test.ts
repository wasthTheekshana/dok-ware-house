/// <reference types="jest" />
import { computeVariance } from '../utils/expenseVariance';

describe('computeVariance', () => {
    it('computes value and percent when both current and prior are present', () => {
        expect(computeVariance(150, 100)).toEqual({ value: 50, percent: 50 });
    });

    it('computes a negative variance when current is lower than prior', () => {
        expect(computeVariance(80, 100)).toEqual({ value: -20, percent: -20 });
    });

    it('returns null value and null percent when prior is null (no baseline)', () => {
        expect(computeVariance(150, null)).toEqual({ value: null, percent: null });
    });

    it('returns null value and null percent when current is null', () => {
        expect(computeVariance(null, 100)).toEqual({ value: null, percent: null });
    });

    it('returns a value but null percent when prior is zero (division by zero guarded)', () => {
        expect(computeVariance(50, 0)).toEqual({ value: 50, percent: null });
    });

    it('returns value 0 and null percent when both current and prior are zero', () => {
        expect(computeVariance(0, 0)).toEqual({ value: 0, percent: null });
    });
});
