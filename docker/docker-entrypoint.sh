#!/bin/sh

# S'assurer que le dossier des uploads existe dans le volume de données
mkdir -p /app/data/uploads

# ── Protection par mot de passe (optionnel) ──────────────────────────
# Si OMNIBANK_PASSWORD est défini, activer le Basic Auth Nginx.
# Sinon, l'application reste ouverte (comportement par défaut).
if [ -n "$OMNIBANK_PASSWORD" ]; then
    OMNIBANK_USER="${OMNIBANK_USER:-omnibank}"
    # Générer le fichier .htpasswd avec le mot de passe fourni
    printf "%s:%s\n" "$OMNIBANK_USER" "$(printf '%s' "$OMNIBANK_PASSWORD" | openssl passwd -apr1 -stdin)" > /etc/nginx/.htpasswd
    # Activer la configuration d'authentification
    cp /app/docker/nginx-auth.conf /etc/nginx/conf.d/auth.conf
    echo "🔒 Protection par mot de passe activée (utilisateur: $OMNIBANK_USER)"
else
    # Désactiver l'auth (fichier vide)
    echo "" > /etc/nginx/conf.d/auth.conf
    echo "🔓 Aucun mot de passe configuré — accès libre"
fi

# Démarrer Nginx en arrière-plan
echo "Démarrage de Nginx..."
nginx

# Démarrer Uvicorn au premier plan sur le port interne 8435
# uvloop + httptools = event loop C optimisé (~2-4x plus rapide que asyncio par défaut)
# Un seul worker pour éviter les erreurs "database is locked" avec SQLite
echo "Démarrage d'Uvicorn sur le port 8435 (uvloop)..."
exec uvicorn app.main:app --host 127.0.0.1 --port 8435 --loop uvloop --http httptools
