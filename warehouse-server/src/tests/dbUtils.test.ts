/// <reference types="jest" />

// Fake pg client/pool used to exercise the real withTransaction implementation
// (as opposed to every other test suite, which mocks dbUtils itself).
const fakeClient = {
    query: jest.fn(),
    release: jest.fn(),
};

const fakePool = {
    connect: jest.fn(async () => fakeClient),
};

jest.mock('../db/config', () => ({
    getPool: () => fakePool,
}));

import { convertParams, execute, withTransaction } from '../db/dbUtils';

describe('convertParams', () => {
    it('binds two distinct named placeholders', () => {
        const { text, values } = convertParams('SELECT * FROM t WHERE a = :a AND b = :b', { a: 1, b: 2 });
        expect(text).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
        expect(values).toEqual([1, 2]);
    });

    it('reuses the same positional index when a named placeholder repeats', () => {
        const { text, values } = convertParams(
            'SELECT * FROM t WHERE a = :x OR b = :x',
            { x: 42 }
        );
        expect(text).toBe('SELECT * FROM t WHERE a = $1 OR b = $1');
        expect(values).toEqual([42]);
    });

    it('maps positional array params to $1, $2, ... in occurrence order', () => {
        const { text, values } = convertParams(
            'SELECT * FROM t WHERE a = :a AND b = :b AND c = :a',
            [1, 2, 3]
        );
        // Array mode ignores param names entirely — every placeholder occurrence
        // gets the next positional index, regardless of repeated names.
        expect(text).toBe('SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3');
        expect(values).toEqual([1, 2, 3]);
    });

    it('does not mistake a ::cast for a named param, and only rewrites the real one', () => {
        const { text, values } = convertParams('SELECT x::int FROM t WHERE y = :y', { y: 5 });
        expect(text).toBe('SELECT x::int FROM t WHERE y = $1');
        expect(values).toEqual([5]);
    });

    it('does not mistake a ::date cast for a named param', () => {
        const { text, values } = convertParams(
            "SELECT date_trunc('month', event_date)::date AS bucket FROM t WHERE dept = :dept",
            { dept: 7 }
        );
        expect(text).toBe("SELECT date_trunc('month', event_date)::date AS bucket FROM t WHERE dept = $1");
        expect(values).toEqual([7]);
    });

    it('does not rewrite something that looks like a param inside a string literal', () => {
        const { text, values } = convertParams(
            "SELECT * FROM t WHERE status = 'active:test' AND id = :id",
            { id: 3 }
        );
        expect(text).toBe("SELECT * FROM t WHERE status = 'active:test' AND id = $1");
        expect(values).toEqual([3]);
    });
});

describe('withTransaction', () => {
    beforeEach(() => {
        fakeClient.query.mockReset();
        fakeClient.release.mockReset();
        fakeClient.query.mockResolvedValue({ rows: [] });
    });

    it('runs BEGIN before the callback and COMMIT after on success, then releases the client', async () => {
        const callOrder: string[] = [];
        fakeClient.query.mockImplementation(async (sql: string) => {
            callOrder.push(sql);
            return { rows: [] };
        });

        const result = await withTransaction(async (exec) => {
            callOrder.push('CALLBACK');
            await exec('SELECT 1');
            return 'done';
        });

        expect(result).toBe('done');
        expect(callOrder[0]).toBe('BEGIN');
        expect(callOrder[callOrder.length - 1]).toBe('COMMIT');
        expect(callOrder).toContain('CALLBACK');
        expect(callOrder.indexOf('BEGIN')).toBeLessThan(callOrder.indexOf('CALLBACK'));
        expect(callOrder.indexOf('CALLBACK')).toBeLessThan(callOrder.indexOf('COMMIT'));
        expect(fakeClient.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back, propagates the error, and still releases the client when the callback throws', async () => {
        const err = new Error('boom');
        const queries: string[] = [];
        fakeClient.query.mockImplementation(async (sql: string) => {
            queries.push(sql);
            return { rows: [] };
        });

        await expect(
            withTransaction(async () => {
                throw err;
            })
        ).rejects.toThrow('boom');

        expect(queries).toContain('BEGIN');
        expect(queries).toContain('ROLLBACK');
        expect(queries).not.toContain('COMMIT');
        expect(fakeClient.release).toHaveBeenCalledTimes(1);
    });
});

describe('execute', () => {
    beforeEach(() => {
        fakeClient.query.mockReset();
        fakeClient.release.mockReset();
    });

    it('uppercases returned row keys and releases the client', async () => {
        fakeClient.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'x' }] });

        const { rows } = await execute('SELECT id, name FROM t WHERE id = :id', { id: 1 });

        expect(rows).toEqual([{ ID: 1, NAME: 'x' }]);
        expect(fakeClient.release).toHaveBeenCalledTimes(1);
    });
});
