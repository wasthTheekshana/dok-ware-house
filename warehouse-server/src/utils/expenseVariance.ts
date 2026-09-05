export interface Variance {
    value: number | null;
    percent: number | null;
}

export function computeVariance(current: number | null, prior: number | null): Variance {
    if (current === null || prior === null) {
        return { value: null, percent: null };
    }
    const value = current - prior;
    if (prior === 0) {
        return { value, percent: null };
    }
    return { value, percent: (value / prior) * 100 };
}
