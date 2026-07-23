# 🏷️ Page Documentation: Categories

The **Categories** page manages the accounting hierarchy for classifying income and expense transactions in OmniBank Local.

---

## 📸 Illustration

![Categories Management](../../../screenshots/09_catégories.png)
*Hierarchical category and subcategory tree with custom icons and colors.*

---

## 🛠️ Components & Features

### 1. Hierarchical Tree (Parent / Subcategory)
Financial classification relies on a two-tier structure:
- **Parent Category**: Top-level spending/income umbrella (e.g., *Groceries*, *Housing*, *Work Income*).
- **Subcategory**: Specific line items (e.g., *Supermarket*, *Bakery*, *Rent*, *Utilities*, *Net Salary*).

### 2. Visual Customization
Each category or subcategory features customizable attributes:
- **Name** (translatable or custom text).
- **Icon**: Vector icon selection (shopping cart, car, house, lightbulb, restaurant, etc.).
- **Color**: Tailored color palette for instant identification across analytical charts.
- **Type**: *Income* (Credit) or *Expense* (Fixed or Variable).

### 3. Safe Category Deletion & Merging
- **Safe Deletion**: Deleting a category associated with existing transactions prompts you to reassign those transactions to another category of your choice.
- **Merging**: Merge duplicate or similar categories without losing historical records.
