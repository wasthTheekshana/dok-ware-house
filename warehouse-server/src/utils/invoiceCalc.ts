export interface InvoicePrices {
    archived: number;
    retrieved: number;
    emptyCarton: number;
}

export interface InvoiceAmounts {
    subtotal: number;
    ssclAmount: number;
    vatAmount: number;
    totalAmount: number;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function computeInvoiceAmounts(
    archivedCount: number,
    retrievedCount: number,
    emptyCartonCount: number,
    prices: InvoicePrices,
    ssclRate: number,
    vatRate: number
): InvoiceAmounts {
    const subtotal = round2(
        archivedCount * prices.archived +
        retrievedCount * prices.retrieved +
        emptyCartonCount * prices.emptyCarton
    );
    const ssclAmount = round2(subtotal * ssclRate);
    const vatAmount = round2((subtotal + ssclAmount) * vatRate);
    const totalAmount = round2(subtotal + ssclAmount + vatAmount);
    return { subtotal, ssclAmount, vatAmount, totalAmount };
}
