

import React from 'react';

interface StatCardProps {
  title: string;
  value: string;
  isProfit?: boolean;
  tooltip?: string;
  onClick?: () => void;
  isAlert?: boolean;
  size?: 'normal' | 'small';
}

const StatCard: React.FC<StatCardProps> = ({ title, value, isProfit, tooltip, onClick, isAlert, size = 'normal' }) => {
  const valueColor = isAlert
    ? 'text-yellow-400'
    : isProfit === undefined 
    ? 'text-white' 
    : isProfit 
    ? 'text-success' 
    : 'text-danger';

  const containerClasses = `bg-gray-800 ${size === 'small' ? 'p-3' : 'p-6'} rounded-lg shadow-lg ${onClick ? 'cursor-pointer hover:bg-gray-700 transition-colors' : ''}`;
  const titleClasses = `font-medium uppercase tracking-wider ${size === 'small' ? 'text-xs' : 'text-sm'} ${isAlert ? 'text-yellow-400' : 'text-gray-400'}`;
  const valueClasses = `font-bold ${size === 'small' ? 'text-2xl mt-1' : 'text-3xl mt-2'} ${valueColor}`;


  return (
    <div className={containerClasses} title={tooltip} onClick={onClick}>
      <h3 className={titleClasses}>{title}</h3>
      <p className={valueClasses}>{value}</p>
    </div>
  );
};

export default StatCard;