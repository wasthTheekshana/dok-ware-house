import React from 'react';

export type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const TONE_CLASSES: Record<BadgeTone, string> = {
    success: 'bg-emerald-50 text-emerald-700',
    info: 'bg-sky-50 text-sky-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
    neutral: 'bg-slate-100 text-slate-600',
};

interface BadgeProps {
    tone: BadgeTone;
    children: React.ReactNode;
}

const Badge: React.FC<BadgeProps> = ({ tone, children }) => (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[tone]}`}>
        {children}
    </span>
);

export default Badge;
