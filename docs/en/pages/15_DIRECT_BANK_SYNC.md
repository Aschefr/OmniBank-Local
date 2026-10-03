# 🏦 Documentation Page: Direct Bank Synchronization (Woob & Vault)

**Direct Bank Synchronization** (`static/js/views/bank_sync.js` and associated sub-modules) allows OmniBank Local to fetch statements, transactions, and balances directly without relying on third-party cloud aggregators (such as Plaid, Budget Insight, or Salt Edge).

---

## 🎯 1. Sovereignty & Zero-Cloud Architecture

Unlike conventional web-based financial software that stores your banking credentials on remote cloud databases:
- **100% Local Engine (Woob)**: Communication with your financial institution is handled locally between your personal machine and your bank's portal via the battle-tested open-source **Woob** (*Web Outside of Browsers*) library.
- **Zero Intermediaries**: No financial data packets ever pass through Amify Studio servers or external third parties.
- **Hybrid Freedom**: You retain complete flexibility to mix and match direct sync, manual CSV/Excel statement imports, or manual entry across different accounts.

---

## 🔐 2. The Encrypted Master Vault

Security for banking credentials relies on a local encrypted vault (`bank_sync_vault.js`):

1. **AES-256 (Fernet) & PBKDF2 Encryption**:
   - Banking credentials are encrypted on local disk using a key derived from your **Master Password** using PBKDF2 (100,000 hashing iterations with a cryptographic salt).
2. **RAM-Only Decryption**:
   - When launching a session, you are prompted to unlock your vault with your master password.
   - The decryption key exists solely in volatile memory (RAM) and is purged immediately upon quitting the application or following an idle timeout.
   - No plaintext banking passwords are ever stored on your hard drive.

---

## 🏛️ 3. Managing Bank Connections

Accessible via **Accounts > Bank Sync** or from the application configuration:

### A. Adding a Connection
1. Click on **"+ Add Bank Connection"**.
2. Select your financial institution from dozens of supported French and European banks (BoursoBank, BNP Paribas, Crédit Agricole, Société Générale, La Banque Postale, CIC, Fortuneo, Revolut, etc.).
3. Enter your online banking username and login password.
4. The system executes a connection test and processes any necessary security challenges.

### B. Strong Customer Authentication (2FA / SCA)
When an institution mandates two-factor verification:
- An interactive challenge modal automatically opens within OmniBank Local.
- The workflow supports both **SMS OTP codes** and in-app approvals on your bank's **mobile smartphone app**.

### C. Account Mapping
Once authenticated, OmniBank displays all remote accounts detected (Checking, Savings, Money Market, Deferred Debit):
- Map each remote bank account to its corresponding local OmniBank account.
- Specify whether the account should synchronize automatically or on demand.

---

## ⚡ 4. Background Sync & Scheduling

- **Scheduled Auto-Sync**: Configure your preferred sync cadence (every 12h, 24h, 48h, or upon opening the application).
- **1-Click Manual Sync**: Trigger on-demand synchronization at any time directly from the accounts view or the navigation toolbar.

---

## 🛡️ 5. Pending Sync & Integrity Guard

To ensure strict financial integrity, OmniBank Local verifies all incoming statement batches prior to database insertion:

- **Deterministic Deduplication**: Every remote operation generates a deterministic fingerprint (SHA-256 hash), guaranteeing that duplicate records are never created even during frequent sync runs.
- **Staging Area ("Pending Sync")**: Incoming transactions are staged in a quarantine view for inspection.
- **Balance Variance Circuit Breaker**: If an abnormal deviation is detected (e.g., an unexplained multi-thousand euro balance jump disconnected from transaction history), direct sync is paused and user confirmation is requested.
- **Review Queue**: Review staged entries and adjust categories prior to final database commitment.

---

## 💡 Tips & Best Practices

> [!IMPORTANT]
> Never lose your Master Vault password: adhering to true *Zero-Knowledge* encryption principles, no one (not even the OmniBank developers) can recover your credentials. If lost, you will need to reset the vault and re-link your bank connections.

> [!TIP]
> When **Auto-Pilot** and **Direct Sync** are used together, newly cleared transactions are fetched, categorized, and reconciled in the background completely autonomously upon opening the app.
