# 🏦 Documentation Page : Synchronisation Bancaire Directe (Woob & Coffre-Fort)

La **Synchronisation Bancaire Directe** (`static/js/views/bank_sync.js` et sous-modules associés) permet de relever automatiquement vos opérations et soldes bancaires sans dépendre d'agrégateurs cloud tiers (tels que Plaid, Budget Insight ou Salt Edge).

---

## 🎯 1. Souveraineté & Architecture Zéro Cloud

Contrairement aux applications financières en ligne traditionnelles qui conservent vos identifiants bancaires sur des serveurs distants :
- **Moteur 100% Local (Woob)** : Le dialogue avec votre banque s'exécute directement entre votre machine et l'API/portail de votre établissement bancaire via le projet open-source éprouvé **Woob** (*Web Outside of Browsers*).
- **Zéro Intermédiaire** : Aucun flux ne transite par les serveurs d'Amify Studio ou de prestataires externes.
- **Fonctionnement Hybride** : Vous restez toujours libre d'utiliser la synchronisation directe, l'importation de fichiers CSV/Excel, ou la saisie manuelle selon votre préférence pour chaque compte.

---

## 🔐 2. Le Coffre-Fort Chiffré Maître (Vault)

La sécurité de vos identifiants repose sur un coffre-fort local chiffré (`bank_sync_vault.js`) :

1. **Chiffrement AES-256 (Fernet) & PBKDF2** :
   - Vos identifiants bancaires sont chiffrés sur votre disque local avec une clé dérivée de votre **Mot de passe maître** à l'aide de l'algorithme PBKDF2 (100 000 itérations avec sel cryptographique).
2. **Déverrouillage en Mémoire Vive (RAM)** :
   - À l'ouverture de session, l'application vous invite à saisir votre mot de passe maître.
   - La clé de déchiffrement n'est conservée qu'en mémoire vive et s'efface automatiquement à la fermeture de l'application ou après une période d'inactivité.
   - Aucun mot de passe bancaire n'est jamais stocké en clair sur votre disque dur.

---

## 🏛️ 3. Gestion des Connexions Bancaires

Accessible via **Comptes > Synchronisation Bancaire** ou depuis la configuration :

### A. Ajouter une Connexion
1. Cliquez sur **"+ Ajouter une banque"**.
2. Sélectionnez votre établissement parmi les dizaines de banques françaises et européennes supportées (BoursoBank, BNP Paribas, Crédit Agricole, Société Générale, La Banque Postale, CIC, Fortuneo, Revolut, etc.).
3. Saisissez votre identifiant et votre mot de passe d'accès bancaire.
4. L'application initie la connexion de test et procède au challenge de sécurité.

### B. Authentification Forte (2FA / SCA)
Lorsqu'un établissement requiert une validation de sécurité à deux facteurs :
- Une modale interactive dédiée s'affiche automatiquement dans OmniBank Local.
- L'application prend en charge la saisie de **code SMS / OTP** ainsi que la validation par notification sur l'**application mobile** de votre banque.

### C. Association des Comptes (Mapping)
Une fois la banque connectée, OmniBank liste les comptes distants détectés (Compte Courant, Livret A, LDDS, Carte à débit différé) :
- Associez chaque compte distant au compte correspondant créé dans OmniBank Local.
- Définissez si le compte doit être synchronisé automatiquement ou manuellement.

---

## ⚡ 4. Synchronisation en Arrière-Plan & Fréquence

- **Relevé Automatique Planifié** : Configurez la fréquence de synchronisation souhaitée (toutes les 12h, 24h, 48h, ou uniquement au lancement de l'application).
- **Synchronisation Manuelle "1-Clic"** : Cliquez sur le bouton de synchronisation dans la barre de navigation ou sur la fiche du compte pour relever immédiatement les dernières écritures.

---

## 🛡️ 5. Sas d'Attente & Garde-Fou d'Intégrité (Integrity Guard)

Pour garantir une étanchéité comptable absolue, OmniBank Local applique un principe de précaution avant d'inscrire les opérations dans la base de données :

- **Déduplication Déterministe** : Chaque opération distante génère une empreinte unique (hash SHA-256) garantissant qu'aucune opération ne sera enregistrée en double, même lors de synchronisations rapprochées.
- **Sas d'Attente ("Pending Sync")** : Les opérations relevées sont d'abord placées dans un sas temporaire pour vérification.
- **Disjoncteur d'Écart de Solde** : Si une anomalie majeure est détectée (ex: variation subite de solde de plusieurs milliers d'euros non corrélée aux opérations), le système bloque temporairement l'application directe et demande confirmation à l'utilisateur.
- **File de Revue** : L'utilisateur peut prévisualiser les écritures prêtes à être inscrites et corriger une catégorie en direct avant la validation finale.

---

## 💡 Astuces & Bonnes Pratiques

> [!IMPORTANT]
> Ne perdez jamais votre mot de passe maître de coffre-fort : en vertu du chiffrement sans porte dérobée (*Zero-Knowledge*), personne (pas même les développeurs d'OmniBank) ne peut récupérer vos identifiants si vous l'oubliez. En cas de perte, il vous suffira de réinitialiser le coffre et de reconnecter vos comptes.

> [!TIP]
> Si vous activez conjointement l'**Auto-Pilote** et la **Synchronisation Directe**, vos nouvelles opérations bancaires seront relevées, catégorisées et rapprochées en tâche de fond de manière 100% autonome dès l'ouverture de l'application.
