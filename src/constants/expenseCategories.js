export const EXPENSE_CATEGORIES = [
  'Inventory purchases',
  'Staff salaries',
  'Utilities (electricity, gas)',
  'Rent',
  'Maintenance',
  'Marketing',
];

export const EXPENSE_CATEGORY_SET = new Set(EXPENSE_CATEGORIES);

// Only categories that represent item-based purchases should require Quantity/Unit.
// Everything else is typically a single amount (e.g., salaries, rent, utilities).
export const EXPENSE_CATEGORIES_WITH_UNITS = [
  'Inventory purchases',
];

const EXPENSE_CATEGORIES_WITH_UNITS_SET = new Set(EXPENSE_CATEGORIES_WITH_UNITS);

export function expenseCategoryUsesUnits(category) {
  const val = (category || '').trim();
  if (!val) return true; // default UI state before selection
  return EXPENSE_CATEGORIES_WITH_UNITS_SET.has(val);
}

export function getExpenseCategoryOptions(currentCategory) {
  const current = (currentCategory || '').trim();
  if (!current || EXPENSE_CATEGORIES.includes(current)) return EXPENSE_CATEGORIES;
  // Preserve legacy / custom category values in edit mode without blocking save.
  return [...EXPENSE_CATEGORIES, current];
}

export function isValidExpenseCategory(category) {
  const val = (category || '').trim();
  if (!val) return true; // allow blank/uncategorized
  return EXPENSE_CATEGORY_SET.has(val);
}
