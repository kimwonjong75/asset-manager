import React from 'react';

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  title?: string;
}

const Toggle: React.FC<ToggleProps> = ({ label, checked, onChange, className = '', title }) => {
  return (
    <label className={`flex items-center cursor-pointer ${className}`} title={title}>
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className={`block ${checked ? 'bg-primary' : 'bg-gray-600'} w-10 h-6 rounded-full transition-colors duration-300 ease-in-out`}></div>
        <div className={`absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300 ease-in-out ${checked ? 'transform translate-x-full' : ''}`}></div>
      </div>
      {label && (
        <div className="ml-3 text-sm font-medium text-gray-300">{label}</div>
      )}
    </label>
  );
};

export default Toggle;

