export interface TemplateVars {
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  customerName: string;
  reminderNumber?: string;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Plain `{{variable}}` substitution — not a template engine (no conditionals/loops), matching
 * what the spec actually asks for. An unknown placeholder is left as-is rather than throwing,
 * so a typo in a user-edited template degrades to visible text instead of blocking sending.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const dict: Record<string, string | undefined> = { ...vars };
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = dict[key];
    return value !== undefined ? value : match;
  });
}
