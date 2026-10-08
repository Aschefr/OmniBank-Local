# Fiche de Connaissances : Comptes Bancaires, Imports et Synchronisation

## 1. Typologie des Comptes Bancaires
OmniBank prend en charge différents types de comptes :
- **Compte Courant (`checking`)** : Compte opérationnel principal supportant les dépenses quotidiennes, la réception des salaires et le prélèvement des charges fixes.
- **Livrets et Épargne Liquide (`savings`)** : Livret A, LDDS, LEP, Livret Jeune. Constitue l'épargne de précaution immédiatement mobilisable.
- **Placements et Épargne Bloquée (`investment`)** : PEA, Assurance-Vie, Comptes-Titres, Épargne Salariale, Crypto.
- **Prêts et Crédits (`loan`)** : Crédit immobilier, prêt personnel, crédit auto. Suivi du capital restant dû et des mensualités.

## 2. Méthodes d'Importation
1. **Importation Manuelle de Relevés (CSV / XLSX)** :
   - Assistant intelligent détectant automatiquement la ligne d'en-tête, le format des dates (`JJ/MM/AAAA`, `AAAA-MM-JJ`), les séparateurs (point-virgule, virgule, tabulation), et le sens des montants.
   - Algorithme anti-doublon comparant la date, le montant et le libellé pour ne pas insérer deux fois les opérations déjà présentes.
2. **Synchronisation Bancaire Directe Locale (Woob / Weboob)** :
   - Connexion bancaire directe et autonome depuis l'ordinateur de l'utilisateur vers son établissement bancaire.
   - Zéro intermédiaire cloud : les requêtes partent directement de la machine locale vers la banque.
   - Support de la double authentification bancaire (2FA / SCA) via modal dédié.

## 3. Coffre-Fort Chiffré Local (Vault)
- Les identifiants et mots de passe de synchronisation bancaire sont chiffrés en local avec **AES-256-GCM**.
- La clé de déchiffrement est dérivée du mot de passe maître de l'utilisateur avec **PBKDF2-HMAC-SHA256** (100 000 itérations).
- Aucun mot de passe bancaire n'est jamais stocké en clair ni transmis à l'extérieur.

## 4. Virements Internes Entre Comptes
- Lorsqu'un virement s'effectue entre deux comptes du même profil (ex. Compte Courant $\rightarrow$ Livret A) :
  - Le système détecte l'opération miroir (débit sur le compte source, crédit sur le compte cible).
  - L'opération est identifiée comme un **Virement Interne** : elle ne constitue ni un revenu ni une dépense et n'altère pas le Reste à Vivre ni les statistiques de consommation.
