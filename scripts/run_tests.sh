#!/bin/bash
# Script de lancement des tests automatisés (Docker / Unix)

set -e

# Se positionner dans le dossier du script
cd "$(dirname "$0")"

echo "=== [1/3] Génération de la base de données de test sur mesure ==="
python3 tests/generate_test_db.py || python tests/generate_test_db.py

echo "=== [2/3] Lancement des tests dans le conteneur Docker ==="
# On utilise docker compose run en montant le dossier tests/ pour ne pas modifier docker-compose.yml
docker compose run --rm -v "$(pwd)/tests:/app/tests" -v "$(pwd)/data:/app/data" api pytest tests/

echo "=== [3/3] Nettoyage de la base de données de test ==="
rm -f data/omnibank_test.db

echo "=== TOUS LES TESTS SONT PASSÉS AVEC SUCCÈS ! ==="
