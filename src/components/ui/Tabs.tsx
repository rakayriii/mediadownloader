"use client";

import { createContext, useContext, ReactNode } from "react";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  return context;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className = "" }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className = "" }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={`
        inline-flex items-center
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function TabsTrigger({ value, children, disabled = false, className = "" }: TabsTriggerProps) {
  const context = useTabsContext();
  const activeValue = context?.value ?? "";
  const onValueChange = context?.onValueChange ?? (() => {});
  const isActive = activeValue === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabs-panel-${value}`}
      id={`tabs-trigger-${value}`}
      disabled={disabled}
      onClick={() => !disabled && onValueChange(value)}
      className={`
        inline-flex items-center justify-center font-medium text-sm
        rounded-md transition-colors duration-150
        focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
        disabled:opacity-50 disabled:cursor-not-allowed
        ${isActive
          ? "bg-surface text-on-surface shadow-sm"
          : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className = "" }: TabsContentProps) {
  const context = useTabsContext();
  const activeValue = context?.value ?? "";
  const isActive = activeValue === value;

  if (!isActive) {
    return (
      <div
        role="tabpanel"
        id={`tabs-panel-${value}`}
        aria-labelledby={`tabs-trigger-${value}`}
        className={`${className} hidden`}
        hidden
      >
        {children}
      </div>
    );
  }

  return (
    <div
      role="tabpanel"
      id={`tabs-panel-${value}`}
      aria-labelledby={`tabs-trigger-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}