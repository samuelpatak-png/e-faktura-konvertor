import { type InputHTMLAttributes, type SelectHTMLAttributes, forwardRef, useId } from "react";

interface FieldWrapperProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

interface InputProps extends FieldWrapperProps, InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, required, id, className = "", ...props }, ref) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-ink-700">
          {label} {required && <span className="text-danger-600">*</span>}
        </label>
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={`w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-500/60 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
            error ? "border-danger-600" : "border-line"
          } ${className}`}
          {...props}
        />
        {error ? (
          <p id={`${fieldId}-error`} className="text-sm text-danger-600">
            {error}
          </p>
        ) : hint ? (
          <p id={`${fieldId}-hint`} className="text-sm text-ink-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = "Input";

interface SelectProps extends FieldWrapperProps, SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, required, id, className = "", children, ...props }, ref) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-ink-700">
          {label} {required && <span className="text-danger-600">*</span>}
        </label>
        <select
          ref={ref}
          id={fieldId}
          aria-invalid={!!error}
          className={`w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink-900 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
            error ? "border-danger-600" : "border-line"
          } ${className}`}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        {hint && !error && <p className="text-sm text-ink-500">{hint}</p>}
      </div>
    );
  }
);
Select.displayName = "Select";
