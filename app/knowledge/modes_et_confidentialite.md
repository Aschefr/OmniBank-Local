# Fiche de Connaissances : Souveraineté, Modes de Fonctionnement et Confidentialité

## 1. Souveraineté des Données et Philosophie 100% Locale
OmniBank est une application conçue selon le principe **Local-First & Zero-Cloud** :
- **Base de Données Locale** : Toutes les données financières sont enregistrées dans un fichier SQLite local sur l'appareil de l'utilisateur.
- **Zéro Télémétrie / Zéro Tracking** : Aucun appel réseau n'est envoyé vers des serveurs externes.
- **IA Locale Dédiée** : L'assistant fonctionne via un serveur Ollama local auto-hébergé sur la machine (modèles Qwen, Llama, Mistral, etc.). Aucune information financière ne transite par des API cloud tierces (OpenAI, Anthropic ou Google).

## 2. Modes d'Utilisation
1. **Mode Personnel** :
   - Conçu pour les particuliers et les ménages.
   - Pilotage par cycle de paie (`predict_next_paycheck`), calcul du Reste à Vivre, enveloppes de vie quotidienne et projection de patrimoine personnel.
2. **Mode Organisation (Licence Pro / CSE / Associations)** :
   - Conçu pour les structures collectives, trésoriers d'associations ou comités d'entreprise.
   - Gestion multi-utilisateurs avec rôles d'accès, exercice comptable civil ou personnalisé, journalisation fine des écritures et ventilation analytique.

## 3. Mode Privé (.privacy-blur)
- Le **Mode Privé** permet de masquer instantanément l'ensemble des montants, soldes bancaires et indicateurs chiffrés à l'écran par un flou optique sécurisé.
- Activé en 1 clic sur l'icône œil ou via le raccourci clavier `Alt + P`.
- Permet de travailler sur ses finances dans des espaces partagés, transports en commun ou lors de présentations sans exposer sa situation patrimoniale.

## 4. Rôles Spécialisés de l'Assistant IA
L'assistant Ollama peut être engagé sous différents rôles experts :
- **Conseiller (`advisor`)** : Co-pilote financier bienveillant et direct, expliquant la situation courante et proposant des ajustements.
- **Simulateur de Projets (`simulator`)** : Évaluation de projets d'emprunt, d'achats majeurs ou d'investissements.
- **Auditeur de Transactions (`auditor`)** : Détection des incohérences, oublis de pointage et doublons.
- **Optimiseur d'Abonnements (`optimizer`)** : Audit des contrats, récurrences et détection des hausses tarifaires.
- **Prévisionniste (`forecaster`)** : Projections détaillées de trésorerie à 30, 60 et 90 jours.
- **Planificateur Budgétaire (`budget_planner`)** : Recommandations d'ajustement des enveloppes d'après les moyennes réelles.
