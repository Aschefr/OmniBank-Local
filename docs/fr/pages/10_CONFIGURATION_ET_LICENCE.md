# ⚙️ Documentation Page : Configuration & Licence

La page **Configuration** regroupe tous les réglages généraux d'OmniBank Local, la gestion de l'IA locale Ollama, les options avancées de l'interface, la gestion des utilisateurs du Mode Organisation, l'export/import de données et les sauvegardes automatiques.

---

## 📸 Illustration

![Page Configuration](../../../screenshots/11_configuration.png)
*Panneau de configuration globale d'OmniBank Local.*

---

## 🛠️ Composants, Boutons & Fonctionnalités Activables

### 🤖 1. Configuration Ollama (Assistant IA)

- **Interrupteur "Activer l'IA"** : Active ou désactive l'ensemble du module IA local (Chat et Suggestions de budget).
- **Champ "URL Ollama"** : Saisissez l'adresse de votre instance locale Ollama (par défaut `http://127.0.0.1:11434`).
- **Bouton "🔄 Tester & Récupérer Modèles"** : Interroge le serveur Ollama local, vérifie la connexion et rafraîchit la liste des modèles disponibles.
- **Liste déroulante "Modèle Sélectionné"** : Sélectionne le modèle LLM actif. **`gemma4:e4b`** est le modèle fortement recommandé et testé durant le développement.
- **Curseur "Température (Créativité)"** (de 0.0 à 1.0) : Ajuste le degré de liberté du modèle (0.1 à 0.3 recommandé pour la rigueur financière).
- **Taille du Contexte & Boutons Rapides (2K, 4K, 8K, 16K, 32K)** : Définit la mémoire de contexte (ex: 4096 tokens par défaut) pour l'analyse des opérations.
- **Interrupteur "Activer les bilans de santé financière"** : Active l'analyse automatique proactive de vos finances.
  - **Sélecteur "Fréquence des rapports"** : Quotidien, Hebdomadaire (recommandé) ou Mensuel.
  - **Bouton "⚡ Générer un bilan maintenant"** : Génère immédiatement une notification d'analyse financière synthétique.

---

### ⚙️ 2. Fonctionnalités Optionnelles & Interface

- **Interrupteur "Activer la récurrence bi-mensuelle"** : Active la prise en charge des échéances et salaires versés deux fois par mois.
- **Interrupteur "Activer les documents joints"** : Ajoute la possibilité de joindre des fichiers (factures, reçus PDF ou images) sur chaque opération.
- **Interrupteur "Activer les bordereaux de chèques"** : Ajoute un champ dédié à la saisie du numéro de bordereau lors de la création d'un chèque.
- **Interrupteur "Activer le Mode Organisation (Association/CSE)"** : Débloque le suivi d'audit et la gestion multi-utilisateur pour les structures collectives (nécessite une clé de licence).

---

### ⚙️ 3. Paramètres Généraux

- **Champ "Nombre de mois de récurrences à générer à l'avance"** (de 1 à 36 mois) : Définit l'horizon de la **projection automatique glissante** des échéances récurrentes (fixé par défaut à 12 mois).

---

### 👥 4. Mode Organisation & Clé de Licence

- **Obtention d'une Licence** : La licence du Mode Organisation s'acquiert en contactant l'Éditeur **Amify Studio** (`contact@amify-studio.fr` — [amify-studio.fr](https://amify-studio.fr)). Les détails juridiques et tarifaires sont consultables dans la [Licence Organisation](../../LICENSE_ORGANISATION.md).
- **Champ "Clé de Licence"** : Permet de saisir la clé délivrée par Amify Studio pour activer les fonctionnalités d'association/CSE.
- **Panneau "Gestion des Utilisateurs" (`org_users`)** :
  - **Champ "Nom de l'utilisateur" + Bouton "+ Ajouter l'utilisateur"** : Ajoute des profils d'utilisateurs (ex: *Président*, *Trésorier*) pour tracer l'historique d'audit des modifications sur les postes partagés.

---

### 🖥️ 5. Mode Partagé (Multi-Session Windows)

- Permet de configurer l'emplacement du fichier SQLite `omnibank.db` sur un répertoire partagé local pour permettre l'accès successif par différentes sessions d'un même ordinateur.

---

### 📁 6. Gestion des Données & Outils de Maintenance

- **Bouton "📥 Exporter les données (CSV)"** : Exporte la totalité des transactions dans un fichier CSV standard.
- **Bouton "📤 Import CSV vers DB"** : Permet l'injection directe d'un fichier CSV brut dans la base SQLite.
- **Bouton "💾 Télécharger Sauvegarde Complète (ZIP)"** : Génère une archive ZIP sécurisée contenant la base de données SQLite et la configuration.
- **Bouton "📂 Restaurer Sauvegarde (ZIP)"** : Restaure l'intégralité de vos comptes et données à partir d'un fichier ZIP de sauvegarde.
- **Bouton "🧙 Relancer l'assistant d'initialisation"** : Ouvre à nouveau l'assistant de démarrage (Setup Wizard) sans effacer vos données actuelles.
- **Bouton "🔧 Corriger les incohérences de types"** : Outil de maintenance corrigeant les catégories dont le type est incompatible.
- **Bouton "🧹 Nettoyer les récurrences orphelines"** : Supprime les reliquats d'échéances prévisionnelles dont le modèle parent a été retiré.
- **Bouton "🔄 Convertir les opérations à 0€ en sautées"** : Convertit automatiquement les transactions à montant nul en statut ignoré.
- **Bouton "⚠️ Vider la base de données" (Bouton Rouge)** : Action critique permettant de réinitialiser complètement la base SQLite après confirmation.

---

### 💾 7. Sauvegardes Automatiques (Auto-Backup)

- **Interrupteur "Activer les sauvegardes automatiques"** : Active le moteur de sauvegarde périodique en arrière-plan.
- **Sélecteur "Fréquence des sauvegardes"** : Quotidienne, Hebdomadaire ou Mensuelle.
- **Sélecteur "Nombre maximal de sauvegardes conservées"** (3, 5, 10 ou 20) : Définit la politique de rotation des archives.
- **Bouton "▶️ Déclencher une sauvegarde automatique"** : Crée immédiatement un instantané de sauvegarde dans le sous-dossier `data/backups/`.
