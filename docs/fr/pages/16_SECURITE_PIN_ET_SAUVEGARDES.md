# 🔒 Documentation Page : Sécurité des Profils (PIN) & Sauvegardes Chiffrées

Chaque profil maître peut être protégé par un **code PIN facultatif**. Cette page explique ce que le PIN protège, comment le récupérer en cas d'oubli, et comment les sauvegardes traitent les profils protégés.

---

## 🎯 1. Ce que protège le PIN

Un profil **sans PIN** reste librement accessible, comme avant.

Un profil **avec PIN** :
- **Bloque l'accès aux données côté serveur** : tant que le PIN n'a pas été saisi, le serveur refuse toute lecture ou modification des données du profil (opérations, comptes, pièces jointes, exports…). Ce n'est pas seulement un écran affiché par-dessus l'application : un autre onglet, un autre navigateur ou l'application mobile se voient aussi refuser l'accès.
- **Se verrouille réellement** : le bouton *Verrouiller la session* et le verrouillage automatique après inactivité coupent l'accès sur le serveur. Le PIN est aussi redemandé après un redémarrage du serveur, ou après 24 h sans utilisation.
- **Résiste aux essais en série** : après **5 PIN incorrects**, il faut attendre **5 minutes**, même avec le bon PIN. Cela empêche d'essayer les 10 000 combinaisons d'un PIN à 4 chiffres.

> [!IMPORTANT]
> **Limite à connaître :** le PIN protège l'accès *par l'application*. Les fichiers de données sur le disque du serveur ne sont pas chiffrés. Sur un ordinateur partagé, la vraie protection des fichiers vient des comptes Windows (chaque utilisateur son compte et son dossier de données).
>
> En **mode partagé**, les données sont dans `C:\ProgramData\OmniBank`, un dossier souvent lisible par tous les utilisateurs de l'ordinateur.

---

## ⚙️ 2. Configurer, modifier ou supprimer le PIN

Dans **Configuration → Profils maîtres**, sur le profil actif :
- **🔒 PIN** : définir, modifier (le PIN actuel est demandé) ou supprimer le PIN.
- **🗝️ Code de récupération** : générer un nouveau code de récupération (le PIN actuel est demandé, l'ancien code devient invalide).

Seul le profil **actuellement actif** peut gérer son PIN.

---

## 🗝️ 3. Le code de récupération

À chaque création ou changement de PIN, OmniBank affiche **une seule fois** un code de récupération de 16 caractères, par exemple `JZNG-KKY3-DAJZ-6EVL`.

**Notez-le et gardez-le en lieu sûr** (gestionnaire de mots de passe, papier rangé…). Il sert à :
1. **Réinitialiser un PIN oublié** depuis l'écran de verrouillage ;
2. **Restaurer ce profil sur une autre machine** à partir d'une sauvegarde globale.

Les majuscules, minuscules, espaces et tirets n'ont pas d'importance à la saisie.

> [!WARNING]
> Un profil protégé avant cette version n'a pas encore de code de récupération. Un avertissement ⚠️ s'affiche alors sur sa carte : cliquez sur **🗝️ Créer un code de récupération**.

---

## 🆘 4. PIN oublié

### Avec le code de récupération
1. Sur l'écran de verrouillage, choisissez le profil puis cliquez sur **Code PIN oublié ?**
2. Saisissez le code de récupération.
3. Saisissez un nouveau PIN, ou laissez le champ vide pour **supprimer** la protection.
4. Un **nouveau** code de récupération s'affiche : notez-le, l'ancien ne fonctionne plus.

### Sans le code de récupération (secours sur le serveur)
Sur la machine qui héberge OmniBank, dans le dossier de l'application :

```bash
python -m app.reset_pin              # liste les profils protégés
python -m app.reset_pin <profile_id> # supprime le PIN de ce profil
```

Avec Docker :

```bash
docker exec -it <conteneur> python -m app.reset_pin <profile_id>
```

Les données du profil ne sont pas modifiées et il n'est pas nécessaire de redémarrer OmniBank.

> [!WARNING]
> Cette commande rend l'accès au profil, mais **pas** aux sauvegardes globales chiffrées faites avec l'ancien PIN (voir § 5). Elles restent lisibles avec l'ancien code de récupération s'il est retrouvé.

---

## 📦 5. Sauvegardes globales et profils protégés

La sauvegarde globale (**📦 Sauvegarder tous les profils**) et la **sauvegarde automatique** contiennent tous les profils :
- les profils **sans PIN** sont enregistrés normalement ;
- les profils **avec PIN** sont **chiffrés** : sans leur PIN ou leur code de récupération, leur contenu est illisible.

La sauvegarde **ne demande aucun PIN** : elle peut être faite même si des profils sont verrouillés (par exemple sur un ordinateur partagé où chacun a son profil).

### Restaurer une sauvegarde globale
Avec **📂 Restaurer tous les profils**, OmniBank demande le code de chaque profil protégé :

| Situation | Code à saisir |
| :--- | :--- |
| Restauration sur **le même serveur** | Le **PIN** du profil (ou son code de récupération) |
| Restauration sur **une autre machine** | Le **code de récupération**, puis un **nouveau PIN** pour ce profil |
| Champ laissé **vide** | Le profil est **ignoré** : ses données actuelles sur ce serveur sont conservées |

Les autres profils sont restaurés normalement. Les profils présents sur le serveur mais absents de l'archive sont conservés.

> [!NOTE]
> **Pourquoi le PIN ne suffit pas sur une autre machine ?** Un PIN de 4 chiffres n'a que 10 000 combinaisons. Sur le serveur, la limite d'essais le protège. Mais une copie du fichier de sauvegarde pourrait être attaquée hors-ligne en quelques minutes. L'archive ne contient donc que la clé protégée par le **code de récupération** (impossible à deviner en pratique). La clé protégée par le PIN ne quitte jamais le serveur.

### Bon à savoir
- **Changer de PIN** ne rend pas les anciennes sauvegardes illisibles : elles s'ouvrent avec le nouveau PIN.
- **Profil protégé avant cette version** : il n'a pas encore de clé de chiffrement. Il est **exclu** des sauvegardes globales (un message l'indique) jusqu'à ce qu'on le **déverrouille une fois** avec son PIN.
- **Anciennes sauvegardes automatiques** (avant cette version) : elles contiennent tout en clair. Elles ne sont téléchargeables que si aucun autre profil n'a de PIN, et disparaissent au fil de la rotation automatique.
- **Sauvegarde d'un seul profil** (💾 *Télécharger Sauvegarde Complète*) : elle concerne le profil actif, déjà déverrouillé, et n'est pas chiffrée. Conservez-la en lieu sûr.

---

## 🛠️ 6. Détails techniques

- **Sessions** : déverrouiller un profil crée une session côté serveur (`app/services/pin_session.py`), transmise par l'en-tête `X-OmniBank-Session`, un cookie `omni_session` (HttpOnly, SameSite=Strict) ou le paramètre `?omni_session=` (flux EventSource, téléchargements). Un middleware (`pin_session_guard` dans `app/main.py`) refuse les requêtes `/api/*` et `/uploads/*` du profil actif protégé avec un `401` `{"code": "pin_required"}`. Seuls quelques points d'accès restent ouverts (santé, version, liste des profils, déverrouillage, récupération).
- **Stockage des secrets** (`data/profiles.json`) : PIN et code de récupération hachés (PBKDF2-SHA256, 100 000 itérations, sel aléatoire).
- **Chiffrement des sauvegardes** (`app/services/backup_crypto.py`) : une paire de clés X25519 par profil protégé. La clé privée est emballée en AES-256-GCM par le PIN (slot conservé sur le serveur uniquement) et par le code de récupération (slot inclus dans les archives), avec une dérivation PBKDF2-SHA256 de 200 000 itérations. Chaque profil est chiffré en AES-256-GCM avec une clé issue d'un échange X25519 éphémère (HKDF-SHA256).
- **Format d'archive** (`app/services/backup_archive.py`) : `omnibank_backup.json` (manifeste, format 2), `profiles.json` (sans hash de PIN ni slot PIN pour les profils protégés), fichiers des profils libres, et `encrypted/<profile_id>.omnienc`.
- **API** :
  - `POST /api/profiles/{id}/activate` : bascule ou déverrouille ; renvoie `session_token`.
  - `POST /api/profiles/lock` : verrouille la session courante.
  - `POST /api/profiles/{id}/pin/recover` : récupération par code (`recovery_code`, `new_pin` facultatif).
  - `POST /api/profiles/{id}/pin/recovery-code` : nouveau code de récupération (`current_pin`).
  - `POST /api/backup/upload-all` : sans champ `secrets`, répond `409` `{"code": "secrets_required", "profiles": [...]}` ; avec `secrets` (JSON `{profile_id: {"secret", "new_pin"}}`), restaure.
