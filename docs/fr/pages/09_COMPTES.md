# 💳 Documentation Page : Comptes Bancaires

La page **Comptes** vous permet d'ajouter, de configurer, de masquer ou de suivre l'état de chacun de vos comptes bancaires et supports financiers.

---

## 📸 Illustration

![Gestion des Comptes](../../../screenshots/10_comptes.png)
*Liste des comptes bancaires enregistrés avec leurs soldes respectifs.*

---

## 🛠️ Composants & Fonctionnalités

### 1. Types de Comptes Supportés
OmniBank Local gère divers types de structures financières :
- **Compte Courant** (Dépôt au jour le jour)
- **Compte Épargne / Livret** (Livret A, LDD, LEP, etc.)
- **Carte à Débit Différé**
- **Portefeuille d'Investissement / Titres**
- **Compte Association / Caisse d'Espèces**

### 2. Paramètres de Compte
Pour chaque compte, vous pouvez définir :
- **Libellé du compte** (ex: *BNP Compte Joint*, *Boursorama Épargne*).
- **Solde Initial** : Montant de référence lors du premier jour d'utilisation.
- **Devise** : Symbole (€, $, £, CHF, etc.).
- **État d'activité** : Masquez ou archivez un compte clôturé pour ne plus l'afficher dans les sélecteurs tout en conservant son historique.

### 3. Transferts Inter-Comptes (Virements Internes)
Lors de la saisie d'une opération entre deux de vos comptes (ex: du *Compte Courant* vers le *Livret A*) :
- Sélectionnez le type **Virement Interne**.
- OmniBank crée automatiquement une paire d'opérations miroir (un débit sur le compte source et un crédit sur le compte cible), évitant de fausser vos statistiques globales de dépenses.
