#!/bin/sh

# S'assurer que le dossier des uploads existe dans le volume de données
mkdir -p /app/data/uploads

# Démarrer Nginx en arrière-plan
echo "Démarrage de Nginx..."
nginx

# Démarrer Uvicorn au premier plan sur le port interne 8435
echo "Démarrage d'Uvicorn sur le port 8435..."
exec uvicorn app.main:app --host 127.0.0.1 --port 8435
