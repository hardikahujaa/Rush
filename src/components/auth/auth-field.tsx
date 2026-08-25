import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  errors?: string[];
  hint?: string;
};

/**
 * One labelled input with its inline error.
 *
 * The accessibility wiring is the point of extracting this. `aria-invalid` tells
 * a screen reader the field is wrong, and `aria-describedby` points at the
 * message so it is read out with the field rather than being visual-only. Both
 * are easy to forget on one form and impossible to forget when the component
 * owns them.
 */
export function AuthField({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  required,
  defaultValue,
  errors,
  hint,
}: Props) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={hasError}
        aria-describedby={
          [hasError ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {hint && !hasError && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-xs text-destructive">
          {errors![0]}
        </p>
      )}
    </div>
  );
}
