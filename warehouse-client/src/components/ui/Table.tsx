import React from 'react';

interface TableProps {
    headers: string[];
    children: React.ReactNode;
    loading?: boolean;
    empty?: boolean;
    emptyMessage?: string;
    title?: string;
}

const Table: React.FC<TableProps> = ({ headers, children, loading, empty, emptyMessage = 'No records yet', title }) => (
    <div className="bg-white rounded-card shadow-soft overflow-hidden">
        {title && <div className="p-4 border-b border-slate-100 font-semibold text-slate-700 text-sm">{title}</div>}
        <table className="w-full text-sm">
            <thead className="text-left text-slate-400">
                <tr>
                    {headers.map((h) => (
                        <th key={h} className="p-3 font-medium text-xs uppercase tracking-wide">{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {loading ? (
                    <tr><td colSpan={headers.length} className="p-6 text-center text-slate-400">Loading...</td></tr>
                ) : empty ? (
                    <tr><td colSpan={headers.length} className="p-6 text-center text-slate-400">{emptyMessage}</td></tr>
                ) : children}
            </tbody>
        </table>
    </div>
);

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className = '', ...rest }) => (
    <td className={`p-3 border-t border-slate-50 ${className}`} {...rest} />
);

export const Tr: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className = '', ...rest }) => (
    <tr className={`hover:bg-slate-50/50 ${className}`} {...rest} />
);

export default Table;
