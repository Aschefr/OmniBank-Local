# 📖 Documentation & Spécifications API REST - OmniBank Local

Ce répertoire contient les spécifications techniques et les fichiers de schéma **OpenAPI 3.1 / Swagger** décrivant l'ensemble des points d'accès (endpoints) du serveur backend FastAPI d'**OmniBank Local**.

---

## 🚀 Accès Interactif Direct (Swagger UI & ReDoc)

Lorsque l'application OmniBank Local est en cours d'exécution (par défaut sur le port local `8434`), la documentation interactive est disponible directement dans votre navigateur :

| Interface | URL Locale | Description |
| :--- | :--- | :--- |
| **Swagger UI** | [http://localhost:8434/docs](http://localhost:8434/docs) | Interface interactive permettant de tester les requêtes en temps réel, explorer les modèles de données et filtrer par tag. |
| **ReDoc** | [http://localhost:8434/redoc](http://localhost:8434/redoc) | Rendu éditorial clair, optimisé pour la lecture des spécifications et l'intégration. |
| **Schéma OpenAPI JSON** | [http://localhost:8434/openapi.json](http://localhost:8434/openapi.json) | Schéma brut JSON servi dynamiquement par FastAPI. |

### 🔒 Fonctionnement 100% Hors-Ligne (Zero-Cloud)
Conformément aux principes de confidentialité absolue d'OmniBank Local :
- Les bibliothèques graphiques de Swagger UI (`swagger-ui-bundle.js`, `swagger-ui.css`) et ReDoc (`redoc.standalone.js`) sont **hébergées localement** dans `static/vendor/swagger-ui/`.
- **Aucune requête réseau externe** n'est émise vers des CDN distants (comme `cdn.jsdelivr.net` ou `unpkg.com`). L'interface fonctionne parfaitement en environnement déconnecté ou sous pare-feu strict.

---

## 📦 Fichiers de Schéma Inclus

| Fichier | Format | Description |
| :--- | :--- | :--- |
| **[`openapi.json`](openapi.json)** | JSON | Spécification complète OpenAPI 3.1.0 (formaté et indenté). |
| **[`openapi.yaml`](openapi.yaml)** | YAML | Spécification complète OpenAPI 3.1.0 en format YAML compact. |

---

## 🛠️ Utilisation avec des Outils Tiers

Ces schémas peuvent être directement importés dans vos outils de développement favoris :

### 1. Postman / Bruno / Insomnia
1. Ouvrez votre client API (Postman, Bruno ou Insomnia).
2. Choisissez **Import** > **File** et sélectionnez [`openapi.json`](openapi.json) ou [`openapi.yaml`](openapi.yaml).
3. L'ensemble des 220+ routes réparties en 26 tags thématiques sera automatiquement structuré en collections prêtes à l'emploi.

### 2. Génération de Clients Typés (SDK)
Vous pouvez générer automatiquement des clients HTTP (TypeScript, Python, Go, Rust) à partir de la spécification :

```bash
# Exemple avec OpenAPI Generator CLI (TypeScript Axios)
npx @openapitools/openapi-generator-cli generate \
  -i docs/api/openapi.json \
  -g typescript-axios \
  -o ./src/api-client

# Exemple avec Orval (TypeScript React / Vanilla)
npx orval --input docs/api/openapi.json --output ./src/api/
```

---

## 🔄 Régénération des Schémas

Pour mettre à jour les fichiers de spécification après l'ajout ou la modification de routes FastAPI :

```bash
# Exécuter le script d'export
python scripts/export_openapi.py
```

Le script inspecte dynamiquement l'instance `app` de `app/main.py` et met à jour automatiquement `docs/api/openapi.json` et `docs/api/openapi.yaml`.

---

## 📌 En-têtes & Architecture Multi-Profils

### En-tête `X-Profile-ID`
OmniBank Local supporte l'isolation stricte multi-profils (Personnel, Professionnel, Association). 
Pour cibler un profil spécifique lors de vos appels API, fournissez son identifiant :

```http
GET /api/transactions/ HTTP/1.1
Host: 127.0.0.1:8434
X-Profile-ID: association_loi_1901
```

*Note : Si aucun en-tête `X-Profile-ID` n'est fourni, l'application utilise automatiquement le profil actuellement sélectionné en session.*

---

## 📚 Guides Détaillés

Pour une explication exhaustive en français de chacun des 26 modules d'API avec exemples de payloads, référez-vous au guide :
- 📖 [Documentation Exhaustive des APIs (FR)](../fr/04_DOCUMENTATION_API_SWAGGER.md)
- 📖 [Full API Documentation (EN)](../en/04_SWAGGER_API_DOCUMENTATION.md)
