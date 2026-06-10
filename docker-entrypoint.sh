#!/bin/sh

# S'assurer que le dossier des uploads existe dans le volume de données
mkdir -p /app/data/uploads

# Démarrer Nginx en arrière-plan
echo "Démarrage de Nginx..."
nginx

# Démarrer Uvicorn au premier plan sur le port interne 8435
# uvloop + httptools = event loop C optimisé (~2-4x plus rapide que asyncio par défaut)
# Un seul worker pour éviter les erreurs "database is locked" avec SQLite
echo "Démarrage d'Uvicorn sur le port 8435 (uvloop)..."
exec uvicorn app.main:app --host 127.0.0.1 --port 8435 --loop uvloop --http httptools
