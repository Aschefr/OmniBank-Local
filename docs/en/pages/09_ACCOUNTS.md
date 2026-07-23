# 💳 Page Documentation: Accounts

The **Accounts** page configures, tracks, and manages all your bank accounts and financial holdings.

---

## 📸 Illustration

![Accounts Management](../../../screenshots/10_comptes.png)
*List of registered bank accounts showing active balances.*

---

## 🛠️ Components & Features

### 1. Supported Account Types
OmniBank Local manages diverse financial account structures:
- **Checking Account** (Day-to-day deposits)
- **Savings Account / Tax-free Accounts**
- **Deferred Debit Card**
- **Investment Portfolio / Securities**
- **Organization / Cash Box**

### 2. Account Parameters
Each account defines customizable settings:
- **Account Name** (e.g., *Main Checking*, *Emergency Savings*).
- **Initial Balance**: Starting reference balance on setup day.
- **Currency**: Symbol (€, $, £, CHF, etc.).
- **Active State**: Hide or archive closed accounts so they no longer clutter selectors while retaining historical records intact.

### 3. Internal Account Transfers
When recording a movement between two owned accounts (e.g., moving funds from *Checking* to *Savings*):
- Select **Transfer** as the transaction type.
- OmniBank creates a mirror transaction pair (a debit on the source account and a credit on the target account), preventing distorted global expense statistics.
