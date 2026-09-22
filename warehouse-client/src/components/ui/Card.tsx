import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    padded?: boolean;
}

const Card: React.FC<CardProps> = ({ children, className = '', padded = true }) => (
    <div className={`bg-white rounded-card shadow-soft ${padded ? 'p-4' : ''} ${className}`}>
        {children}
    </div>
);

export default Card;
