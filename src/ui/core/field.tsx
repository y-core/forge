import type { FC, PropsWithChildren } from "hono/jsx";
import { cn } from "./utils/cn";

interface FieldProps {
  name: string;
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  class?: string;
}

export function fieldId(name: string): string {
  return `field-${name}`;
}

export function fieldDescriptionId(name: string): string {
  return `field-${name}-description`;
}

export function fieldErrorId(name: string): string {
  return `field-${name}-error`;
}

export const Field: FC<PropsWithChildren<FieldProps>> = ({
  name,
  label,
  description,
  error,
  required,
  class: cls,
  children,
}) => {
  const id = fieldId(name);
  const descId = description ? fieldDescriptionId(name) : undefined;
  const errId = error ? fieldErrorId(name) : undefined;

  return (
    <div class={cn("flex flex-col gap-1.5", cls)}>
      <label
        for={id}
        class="text-sm font-medium text-brand-900"
      >
        {label}
        {required && (
          <span class="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {description && (
        <p id={descId} class="text-xs text-brand-600">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} class="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
