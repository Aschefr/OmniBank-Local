# 🤖 Documentation Page : Assistant Chat IA (Ollama Local)

La page **Chat IA** fournit une interface de dialogue naturelle avec votre conseiller financier personnel autonome. Il fonctionne entièrement hors-ligne sur votre machine via l'instance **Ollama**.

---

## 📸 Illustrations

![Chat IA Interface](../../../screenshots/07_chat_ia.png)
*Interface du Chat IA conversationnel avec historique de discussion et sélecteur de modèle.*

![Chat IA Proposition Action](../../../screenshots/07_chat_ia_proposition_ia.png)
*Proposition d'action automatique par l'IA (Function Calling avec carte de validation).*

---

## 🛠️ Composants & Fonctionnalités

### 1. Dialogue en Langage Naturel
Vous pouvez poser n'importe quelle question sur votre comptabilité ou demander des analyses personnalisées :
- *"Quel a été mon plus gros poste de dépense le mois dernier ?"*
- *"Combien me reste-t-il sur mon budget alimentation ?"*
- *"Est-ce que je peux me permettre d'économiser 200 € ce mois-ci ?"*

### 2. Modèles recommandés
L'assistant de démarrage (étape IA) et **Configuration > Assistant IA** proposent trois modèles. « Utiliser » choisit le modèle et règle sa température et son contexte ; avec Ollama, « Télécharger » le récupère sans passer par la ligne de commande.

| Niveau | Modèle | Mémoire graphique | Réponse du conseiller | Téléchargement |
|---|---|---|---|---|
| Minimum | `gemma4:e4b` | environ 5,4 Go | environ 3,4 s | 6,6 Go |
| Recommandé | `bonsai-2:27b` | environ 9,5 Go | environ 14,6 s | 8,3 Go |
| Top qualité | `gemma4:31b` | environ 22,2 Go | environ 13,8 s | 20,4 Go |

Réglages appliqués : température 0,2 et contexte 32K pour les trois.

Ce choix vient d'un banc d'essai de 9 modèles sur les tâches d'OmniBank : catégorie des libellés d'un vrai relevé, nom et catégorie de libellés inventés, placement des catégories en enveloppes, et vingt questions au conseiller (bons outils, chiffres exacts, rien d'inventé, réponse dans votre langue). Les temps ont été mesurés sur une carte graphique de 24 Go ; sans carte graphique, comptez plusieurs fois plus long.

- **Minimum** : tient sur une carte de 8 Go et répond le plus vite ; le conseiller se trompe plus souvent sur les questions difficiles.
- **Recommandé** : la qualité d'un modèle de 27 milliards de paramètres dans environ 9 Go, grâce à des poids ternaires. Il a répondu juste aux vingt questions du conseiller à chaque passage, mais range moins bien les libellés d'un vrai relevé que les plus gros modèles.
- **Top qualité** : la meilleure note mesurée, pour une carte graphique de 24 Go.

#### Comment ces modèles ont été choisis
Les mêmes chiffres sont affichés dans **Configuration > Assistant IA**, sous les trois cartes. 9 modèles testés du 9 au 11 novembre 2026 sur les tâches d'OmniBank, chaque tâche jouée trois fois, température 0,2, contexte 32K, carte RTX 3090. La note sur 10 ne mesure que la qualité et compte d'abord le travail de tous les jours : vrai relevé 35 % (catégorie de 120 libellés réels), libellés 25 % (45 libellés inventés), enveloppes 25 % (92 catégories à placer dans 13 situations, 97 contrôles), conseiller 15 % (20 questions sur un profil de démonstration : bons outils, chiffres exacts, rien d'inventé ; les questions à chiffres sont aussi rejouées 7 fois). Le conseiller pèse peu dans la note, mais un modèle qui s'y trompe trop est écarté. La vitesse et la mémoire n'y comptent pas. Les 7 autres modèles du premier banc (6 novembre), tous écartés alors, n'ont pas été remesurés.

| Modèle | Rang | Note /10 | Vrai relevé /120 · 35 % | Libellés /45 · 25 % | Enveloppes /97 · 25 % | Conseiller /20 · 15 % | Carte minimale | Mémoire | Réponse |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `gemma4:31b` | Top qualité | **8,9** | 87 | 44 | 95 | 20 | 24 Go et plus | 22,2 Go · Q4 | 13,8 s |
| `qwen3.8:27b` |  | 8,6 | 77–82 | 44 | 92–93 | 20 | 24 Go et plus | 18,7 Go · Q4 | 11,4 s |
| `bonsai-2:27b` | Recommandé | **8,3** | 71–72 | 42 | 93–94 | 20 | 12 Go | 9,5 Go · Q2 | 14,6 s |
| `gemma4:12b` |  | 8,3 | 75–76 | 44 | 91–92 | 17–18 | 12 Go | 9,1 Go · Q4 | 6,4 s |
| `gemma4:e4b` | Minimum | **8,0** | 67–69 | 42 | 90 | 16–19 | 8 Go | 5,4 Go · Q4 | 3,4 s |
| `nemotron-3.5-bolt:e4b` |  | 7,9 | 68–70 | 41 | 88–89 | 16–19 | 12 Go | 7,9 Go · Q4 | 5,2 s |
| `mimo-v2.6:9b` |  | 7,7 | 69 | 40 | 82–86 | 17–18 | 8 Go | 7,0 Go · Q4 | 6,5 s |
| `qwen3.5:9b` | Non retenu · vrai relevé 57/120 | 7,3 | **57–63** | 36–37 | 85–87 | 17–19 | 8 Go | 7,0 Go · Q4 | 6,4 s |
| `qwen3.5:4b` | Non retenu · vrai relevé 57/120 | 7,1 | **57–59** | 38 | 74–77 | 17–18 | 8 Go | 4,5 Go · Q4 | 5,2 s |

Précision : une question vaut au plus 0,075 point dans la note (une question du conseiller). Sous 0,3 point et 4 questions par tâche, deux modèles ne se départagent pas.

- **Non retenu** : moins de 15 bonnes réponses sur 20 au conseiller (75 %), ou une tâche sous la moitié de son score, sur l'un des trois passages. La tâche en cause est indiquée dans la colonne Rang et en gras.
- Top qualité : la meilleure note parmi les modèles qui répondent en moins de 20 s. Alternative : la meilleure note sans limite de temps. Minimum et Recommandé : les modèles conseillés pour les petites et les moyennes cartes, ci-dessous.
- Deux modèles sont à égalité quand leurs notes sont à 4 questions du conseiller l'une de l'autre et que chaque tâche diffère d'au plus 4 questions par passage ; le plus léger l'emporte alors. Ainsi `gemma4:e4b` (5,4 Go) et `nemotron-3.5-bolt:e4b` (7,9 Go) sont à égalité. `bonsai-2:27b` et `gemma4:12b` ne le sont pas malgré la même note : 4 libellés du vrai relevé les séparent à chaque passage, et la meilleure note l'emporte.
- Mémoire : occupée sur la carte graphique une fois le modèle chargé, mesurée avec nvidia-smi ; version par défaut d'Ollama (quantification indiquée quand elle est connue), contexte 32K, cache du contexte 8 bits (q8_0) avec flash attention. Avec le cache par défaut d'Ollama (16 bits), comptez jusqu'à 0,5 Go de plus. Réponse : temps médian du conseiller.

##### Votre carte graphique → modèle conseillé
| Carte graphique | Modèle conseillé |
|---|---|
| 8 Go | `gemma4:e4b` |
| 12 Go | `bonsai-2:27b` |
| 16 Go | `bonsai-2:27b` |
| 24 Go et plus | `gemma4:31b` |

Un modèle tient sur une carte si sa mémoire est au plus la taille de la carte moins 1 Go. Un modèle trop gros marche quand même, en partie en mémoire système, mais beaucoup plus lentement.

##### Et les réglages conseillés
- Contexte 32K : les consignes et les outils du conseiller occupent déjà environ 9 000 tokens. 16K est le minimum accepté ; 32K laisse la place à l'historique de la conversation et aux gros imports.
- Température 0,2 : la valeur du banc. Elle ne règle que le conseiller et les suggestions de budget ; la catégorisation et l'import restent toujours à 0,1.
- Réflexion gardée pour le conseiller (banc du 8 novembre 2026) : sans elle, `gemma4:e4b` n'appelle plus ses outils et tombe de 9 à 2 ou 3 bonnes réponses sur 12, et `bonsai-2:27b` en perd jusqu'à deux. `qwen3.8:27b` n'y perd rien et répond en 7 à 8 s au lieu de 12 : l'interrupteur de Configuration > Assistant IA > Réglages avancés permet de la couper. Les autres tâches de l'IA ne réfléchissent jamais.

Tout autre modèle installé reste disponible dans la liste déroulante. Préférez un modèle qui sait appeler des outils : le conseiller et l'extraction de données en ont besoin.

### 3. Modales d'Action Autonome (Function Calling)
Lorsque vous demandez à l'IA d'exécuter une tâche de gestion (ex: *"Ajoute une dépense de 45€ en supermarché aujourd'hui"*, *"Prépare un virement de précaution de 280 € de mon Livret A vers mon compte courant"*, ou *"Lance une synchronisation bancaire"*), l'IA ne modifie pas vos données sans votre accord :
1. Elle prépare la fonction d'action correspondante :
   - `create_transaction` : Saisie d'une dépense ou d'un revenu.
   - `create_planned_transfer` : Saisie d'un virement prévisionnel direct entre deux de vos comptes.
   - `set_budget` : Ajustement d'une enveloppe budgétaire.
   - `trigger_bank_sync` : Déclenchement d'un relevé en ligne de vos comptes bancaires synchronisés.
2. L'interface affiche une **Carte de Confirmation d'Action** interactive avec les détails précis.
3. Vous validez l'action en cliquant sur **"Confirmer"** (ou annulez), garantissant une sécurité et une maîtrise totales.

### 4. Virements de Précaution et Périmètre Bancaire (Strictement Hors-Ligne & Lecture Seule)
OmniBank et son assistant IA fonctionnent selon une règle fondamentale : **aucune action d'écriture bancaire réelle n'est possible**.
- L'application est strictement en **lecture seule** vis-à-vis des établissements bancaires. Ni l'IA ni l'application ne peuvent déplacer de l'argent réel sur vos comptes bancaires.
- Face à un besoin de trésorerie (ex. déficit de liquidité ou risque de découvert), l'assistant applique le workflow vertueux en **3 étapes** :
  1. **Réalisation bancaire réelle par l'utilisateur** : Vous effectuez le virement réel directement sur l'application ou le site sécurisé de votre banque.
  2. **Enregistrement prévisionnel dans OmniBank** : L'assistant vous propose de saisir immédiatement ce virement prévisionnel dans OmniBank (`create_planned_transfer`). Une fois validé, cela sécurise instantanément vos projections de solde et votre Reste à Vivre (RTL).
  3. **Rapprochement automatique** : Dès que l'opération est traitée par votre banque, le relevé bancaire en ligne (lancé via l'outil `trigger_bank_sync` de l'IA, manuellement, ou par l'Auto-Pilote) détecte l'écriture réelle et la rapproche automatiquement de la ligne prévisionnelle sans doublon.

---

## 🔒 Confidentialité des Données RAG

> [!IMPORTANT]
> Aucune donnée financière, aucun libellé et aucun montant ne sort de votre ordinateur. Les prompts d'analyse sont transmis uniquement au serveur Ollama local sur l'adresse `127.0.0.1`.
