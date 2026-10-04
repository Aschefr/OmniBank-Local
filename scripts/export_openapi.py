"""
Script d'exportation de la spécification OpenAPI / Swagger d'OmniBank Local.
Génère les fichiers docs/api/openapi.json et docs/api/openapi.yaml.
"""

import os
import sys
import json
import logging

# Ensure project root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("export_openapi")


def export_openapi():
    from app.main import app
    import yaml

    api_docs_dir = os.path.join(BASE_DIR, "docs", "api")
    os.makedirs(api_docs_dir, exist_ok=True)

    json_path = os.path.join(api_docs_dir, "openapi.json")
    yaml_path = os.path.join(api_docs_dir, "openapi.yaml")

    logger.info("Génération du schéma OpenAPI depuis l'application FastAPI...")
    schema = app.openapi()

    # 1. Export JSON
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)
    logger.info(f"Schéma JSON exporté avec succès : {json_path} ({os.path.getsize(json_path):,} octets)")

    # 2. Export YAML
    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(schema, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
    logger.info(f"Schéma YAML exporté avec succès : {yaml_path} ({os.path.getsize(yaml_path):,} octets)")

    # Résumé
    paths_count = len(schema.get("paths", {}))
    tags_count = len(schema.get("tags", []))
    schemas_count = len(schema.get("components", {}).get("schemas", {}))

    logger.info(f"--- Résumé OpenAPI ---")
    logger.info(f"Titre : {schema.get('info', {}).get('title')} v{schema.get('info', {}).get('version')}")
    logger.info(f"Endpoints documentés : {paths_count}")
    logger.info(f"Tags / Modules : {tags_count}")
    logger.info(f"Schémas de données : {schemas_count}")


if __name__ == "__main__":
    export_openapi()
