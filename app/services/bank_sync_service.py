"""
OmniBank-Local — Service de Synchronisation Bancaire Universelle (Woob).
Gère la découverte dynamique des banques, l'authentification sécurisée,
le 2FA interactif, le mapping de comptes et la déduplication des écritures.
"""

import hashlib
import json
import logging
import queue
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple

from sqlalchemy.orm import Session
from woob.core import Woob
from woob.exceptions import (
    ActionNeeded,
    AppValidation,
    AppValidationCancelled,
    AppValidationExpired,
    BrowserIncorrectPassword,
    BrowserQuestion,
    BrowserUnavailable,
    DecoupledValidation,
    NeedInteractiveFor2FA,
    OTPQuestion,
    SentOTPQuestion,
)

from app.models import Account, BankConnection, Transaction
from app.schemas.bank_sync_schemas import (
    BackendConfigField,
    BankBackendInfo,
    RemoteAccountOut,
)
from app.services import stats_cache
from app.services.credential_vault import CredentialVault
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

# Cache mémoire pour les sessions 2FA interactives
# session_id -> {"queue": Queue, "event": threading.Event, "response": None}
_TWOFA_SESSIONS: Dict[str, Dict[str, Any]] = {}
_TWOFA_LOCK = threading.Lock()

# Cache singleton pour l'instance Woob
_WOOB_INSTANCE: Optional[Woob] = None
_BACKENDS_CACHE: Optional[List[BankBackendInfo]] = None
_CACHE_TIMESTAMP: float = 0


def get_woob() -> Woob:
    """Retourne une instance Woob réutilisable."""
    global _WOOB_INSTANCE
    if _WOOB_INSTANCE is None:
        _WOOB_INSTANCE = Woob()
    return _WOOB_INSTANCE


def _apply_module_hotfixes(w: Woob, backend_name: str, backend: Any = None):
    """Applique les correctifs de compatibilité connus sur les modules Woob si nécessaire."""
    # S'assurer que le module requis est bien installé localement avant d'appliquer un correctif
    try:
        w.repositories.install(backend_name)
    except Exception as e:
        logger.debug(f"[BankSync] Module install check notice ({backend_name}): {e}")

    if backend_name == "boursorama":
        try:
            import pathlib
            mod = w.modules_loader.get_or_load_module("boursorama")
            if hasattr(mod, "package") and hasattr(mod.package, "__file__"):
                pkg_dir = pathlib.Path(mod.package.__file__).parent
                pages_file = pkg_dir / "pages.py"
                if pages_file.exists():
                    content = pages_file.read_text(encoding="utf-8")
                    target_old = 'return HasElement("//title")(self.doc)'
                    target_new = 'return HasElement(\'//form[@name="form"]\')(self.doc)'
                    if target_old in content:
                        content = content.replace(target_old, target_new)
                        pages_file.write_text(content, encoding="utf-8")
                        logger.info("[BankSync] Hotfix BoursoBank appliqué avec succès.")
        except Exception as e:
            logger.debug(f"[BankSync] Hotfix BoursoBank notice: {e}")

    elif backend_name == "cragr":
        try:
            import sys
            import pathlib
            import importlib

            # Fonction d'extraction ultra-résiliente de clientId dans l'arbre JSON
            def _extract_ca_client_id(doc):
                if not isinstance(doc, dict):
                    return None
                if doc.get("clientId"):
                    return doc["clientId"]
                if isinstance(doc.get("mireOptions"), dict) and doc["mireOptions"].get("clientId"):
                    return doc["mireOptions"]["clientId"]
                # Parcours récursif en cas de sous-objet supplémentaire dans app-config.json
                for _, v in doc.items():
                    if isinstance(v, dict):
                        found = _extract_ca_client_id(v)
                        if found:
                            return found
                return None

            # Fallback vers l'identifiant client public officiel du portail web Crédit Agricole
            CA_PUBLIC_CLIENT_ID_FALLBACK = "cb811bccb65f9f25d74430e1cca02fed3a3c1deaccfe2ebfb1b52b7eb68cd284"

            def make_patched_get_client_id(orig_fn):
                def patched_get_client_id(self):
                    cid = _extract_ca_client_id(self.doc)
                    if cid:
                        return cid
                    if orig_fn:
                        try:
                            orig_cid = orig_fn(self)
                            if orig_cid:
                                return orig_cid
                        except Exception:
                            pass
                    return CA_PUBLIC_CLIENT_ID_FALLBACK
                return patched_get_client_id

            mod = None
            try:
                mod = w.modules_loader.get_or_load_module("cragr")
            except Exception as e:
                logger.debug(f"[BankSync] Chargement module cragr notice: {e}")

            # 1. Résolution du module de pages cragr
            pages_mod = None
            for mod_name in ("woob_modules.cragr.pages", "cragr.pages"):
                try:
                    pages_mod = importlib.import_module(mod_name)
                    if pages_mod:
                        break
                except Exception:
                    pages_mod = sys.modules.get(mod_name)
                    if pages_mod:
                        break

            # 2. Patch en mémoire des classes AppConfigPage
            target_classes = []
            if pages_mod and hasattr(pages_mod, "AppConfigPage"):
                target_classes.append(pages_mod.AppConfigPage)

            if backend and hasattr(backend, "browser"):
                for attr_name in ("espace_config", "caconnect_config"):
                    endpoint = getattr(backend.browser, attr_name, None)
                    if endpoint and hasattr(endpoint, "klass") and endpoint.klass not in target_classes:
                        target_classes.append(endpoint.klass)

            for cls in target_classes:
                if hasattr(cls, "get_client_id") and not getattr(cls, "_cragr_clientid_hotfixed_v2", False):
                    cls.get_client_id = make_patched_get_client_id(cls.get_client_id)
                    cls._cragr_clientid_hotfixed_v2 = True
                    logger.info("[BankSync] Hotfix mémoire Crédit Agricole (clientId dans mireOptions/fallback) appliqué avec succès.")

            # 3. Patch sur disque du fichier pages.py si accessible en écriture
            pkg_dir = None
            if mod and hasattr(mod, "package") and hasattr(mod.package, "__file__"):
                pkg_dir = pathlib.Path(mod.package.__file__).parent
            elif pages_mod and hasattr(pages_mod, "__file__"):
                pkg_dir = pathlib.Path(pages_mod.__file__).parent

            if pkg_dir:
                pages_file = pkg_dir / "pages.py"
                if pages_file.exists():
                    try:
                        content = pages_file.read_text(encoding="utf-8")
                        target_patterns = [
                            'return Dict("clientId")(self.doc)',
                            "return Dict('clientId')(self.doc)"
                        ]
                        replacement = 'return (self.doc.get("clientId") or (self.doc.get("mireOptions") or {}).get("clientId") if isinstance(self.doc, dict) else Dict("clientId")(self.doc))'
                        modified = False
                        for pat in target_patterns:
                            if pat in content:
                                content = content.replace(pat, replacement)
                                modified = True
                        if modified:
                            pages_file.write_text(content, encoding="utf-8")
                            logger.info("[BankSync] Hotfix fichier Crédit Agricole appliqué avec succès.")
                    except Exception as e:
                        logger.debug(f"[BankSync] Écriture hotfix fichier Crédit Agricole notice: {e}")

        except Exception as e:
            logger.debug(f"[BankSync] Hotfix Crédit Agricole notice: {e}")


def init_known_bank_hotfixes():
    """Précharge et applique les correctifs connus au démarrage en arrière-plan sans bloquer l'application."""
    def _worker():
        try:
            w = get_woob()
            for b in ("cragr", "boursorama"):
                try:
                    _apply_module_hotfixes(w, b)
                except Exception as e:
                    logger.debug(f"[BankSync] Notice pré-initialisation banque '{b}' : {e}")
        except Exception as e:
            logger.debug(f"[BankSync] Notice pré-initialisation Woob : {e}")

    import threading
    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def get_all_bank_backends(force_refresh: bool = False) -> List[BankBackendInfo]:
    """
    Découverte dynamique de tous les modules bancaires disponibles dans Woob.
    Retourne la liste des banques avec la description et les champs de configuration attendus.
    """
    global _BACKENDS_CACHE, _CACHE_TIMESTAMP
    now = time.time()
    if _BACKENDS_CACHE is not None and not force_refresh and (now - _CACHE_TIMESTAMP < 3600):
        return _BACKENDS_CACHE

    w = get_woob()
    try:
        mods_info = w.repositories.get_all_modules_info()
    except Exception as e:
        logger.warning(f"[BankSync] Erreur lors de la récupération des modules distants : {e}")
        mods_info = {}

    backends = []
    # Priorité d'affichage pour les banques courantes
    priority_order = [
        "cragr", "boursorama", "bnp", "societegenerale", "bp", "lcl",
        "caissedepargne", "banquepopulaire", "creditmutuel", "cic",
        "fortuneo", "hellobank", "bforbank", "n26", "monabanq", "revolut"
    ]

    for name, info in mods_info.items():
        caps = getattr(info, "capabilities", []) or []
        cap_names = [c if isinstance(c, str) else getattr(c, "__name__", str(c)) for c in caps]
        if not any("Bank" in c or "CapBank" in c for c in cap_names):
            continue

        desc = getattr(info, "description", name) or name
        is_installed = name in w.modules_loader.loaded

        # Inspecter les champs requis si le module est déjà chargé
        fields = _inspect_module_fields(w, name)

        backends.append(BankBackendInfo(
            name=name,
            description=desc,
            is_installed=is_installed,
            fields=fields
        ))

    # Tri : banques prioritaires d'abord, puis ordre alphabétique
    def sort_key(b: BankBackendInfo):
        if b.name in priority_order:
            return (0, priority_order.index(b.name))
        return (1, b.description.lower())

    backends.sort(key=sort_key)
    _BACKENDS_CACHE = backends
    _CACHE_TIMESTAMP = now
    logger.info(f"[BankSync] {len(backends)} backends bancaires découverts.")
    return backends


CRAGR_CAISSES_CHOICES = {
    "www.ca-alpesprovence.fr": "Alpes Provence (www.ca-alpesprovence.fr)",
    "www.ca-alsace-vosges.fr": "Alsace-Vosges (www.ca-alsace-vosges.fr)",
    "www.ca-anjou-maine.fr": "Anjou Maine (www.ca-anjou-maine.fr)",
    "www.ca-aquitaine.fr": "Aquitaine (www.ca-aquitaine.fr)",
    "www.ca-atlantique-vendee.fr": "Atlantique Vendée (www.ca-atlantique-vendee.fr)",
    "www.ca-briepicardie.fr": "Brie Picardie (www.ca-briepicardie.fr)",
    "www.ca-cb.fr": "Champagne Bourgogne (www.ca-cb.fr)",
    "www.ca-centrefrance.fr": "Centre France (www.ca-centrefrance.fr)",
    "www.ca-centreloire.fr": "Centre Loire (www.ca-centreloire.fr)",
    "www.ca-centreouest.fr": "Centre Ouest (www.ca-centreouest.fr)",
    "www.ca-centrest.fr": "Centre Est (www.ca-centrest.fr)",
    "www.ca-charente-perigord.fr": "Charente Périgord (www.ca-charente-perigord.fr)",
    "www.ca-cmds.fr": "Charente-Maritime Deux-Sèvres (www.ca-cmds.fr)",
    "www.ca-corse.fr": "Corse (www.ca-corse.fr)",
    "www.ca-cotesdarmor.fr": "Côtes d'Armor (www.ca-cotesdarmor.fr)",
    "www.ca-des-savoie.fr": "Des Savoie (www.ca-des-savoie.fr)",
    "www.ca-finistere.fr": "Finistère (www.ca-finistere.fr)",
    "www.ca-franchecomte.fr": "Franche-Comté (www.ca-franchecomte.fr)",
    "www.ca-guadeloupe.fr": "Guadeloupe (www.ca-guadeloupe.fr)",
    "www.ca-illeetvilaine.fr": "Ille-et-Vilaine (www.ca-illeetvilaine.fr)",
    "www.ca-languedoc.fr": "Languedoc (www.ca-languedoc.fr)",
    "www.ca-loirehauteloire.fr": "Loire Haute Loire (www.ca-loirehauteloire.fr)",
    "www.ca-lorraine.fr": "Lorraine (www.ca-lorraine.fr)",
    "www.ca-martinique.fr": "Martinique Guyane (www.ca-martinique.fr)",
    "www.ca-morbihan.fr": "Morbihan (www.ca-morbihan.fr)",
    "www.ca-nmp.fr": "Nord Midi-Pyrénées (www.ca-nmp.fr)",
    "www.ca-nord-est.fr": "Nord Est (www.ca-nord-est.fr)",
    "www.ca-norddefrance.fr": "Nord de France (www.ca-norddefrance.fr)",
    "www.ca-normandie-seine.fr": "Normandie Seine (www.ca-normandie-seine.fr)",
    "www.ca-normandie.fr": "Normandie (www.ca-normandie.fr)",
    "www.ca-paris.fr": "Ile-de-France (www.ca-paris.fr)",
    "www.ca-pca.fr": "Provence Côte d'Azur (www.ca-pca.fr)",
    "www.ca-pyrenees-gascogne.fr": "Pyrénées Gascogne (www.ca-pyrenees-gascogne.fr)",
    "www.ca-reunion.fr": "Réunion (www.ca-reunion.fr)",
    "www.ca-sudmed.fr": "Sud Méditerranée (www.ca-sudmed.fr)",
    "www.ca-sudrhonealpes.fr": "Sud Rhône Alpes (www.ca-sudrhonealpes.fr)",
    "www.ca-toulouse31.fr": "Toulouse 31 (www.ca-toulouse31.fr)",
    "www.ca-tourainepoitou.fr": "Touraine Poitou (www.ca-tourainepoitou.fr)",
    "www.ca-valdefrance.fr": "Val de France (www.ca-valdefrance.fr)"
}


def _inspect_module_fields(w: Woob, module_name: str) -> List[BackendConfigField]:
    """Inspecte la configuration d'un module pour générer les champs du formulaire UI."""
    fields = []
    try:
        mod = w.modules_loader.get_or_load_module(module_name)
        config = getattr(mod, "config", {})
        for key, val_obj in config.items():
            if key in ["resume", "request_information", "code", "email_code", "otp", "digital_key", "rotating_password"]:
                # Champs transient/2FA, non demandés au formulaire initial
                continue

            val_type = type(val_obj).__name__.lower()
            field_type = "text"
            if "password" in val_type or "password" in key.lower() or "secret" in key.lower() or "pin" in key.lower():
                field_type = "password"
            elif "bool" in val_type:
                field_type = "checkbox"

            choices_dict = None
            if hasattr(val_obj, "choices") and val_obj.choices:
                field_type = "select"
                choices_dict = {str(k): str(v) for k, v in val_obj.choices.items()}
            elif module_name == "cragr" and key == "website":
                field_type = "select"
                choices_dict = CRAGR_CAISSES_CHOICES

            label = getattr(val_obj, "label", key) or key
            description = getattr(val_obj, "description", None)
            required = getattr(val_obj, "required", True)
            default = str(getattr(val_obj, "default", "")) if getattr(val_obj, "default", None) is not None else ("www.ca-centrest.fr" if module_name == "cragr" and key == "website" else None)

            fields.append(BackendConfigField(
                id=key,
                label=label,
                type=field_type,
                description=description,
                required=required,
                choices=choices_dict,
                default=default
            ))
    except Exception:
        # Fallback générique si le module n'est pas encore installé
        fields = [
            BackendConfigField(id="login", label="Identifiant client", type="text", required=True),
            BackendConfigField(id="password", label="Mot de passe / Code secret", type="password", required=True),
        ]
        if module_name == "cragr":
            fields.append(BackendConfigField(
                id="website",
                label="Caisse régionale",
                type="select",
                choices=CRAGR_CAISSES_CHOICES,
                default="www.ca-centrest.fr",
                required=True
            ))

    return fields


def register_2fa_session(session_id: str) -> queue.Queue:
    """Enregistre une session 2FA pour attendre une réponse du frontend."""
    q: queue.Queue = queue.Queue()
    with _TWOFA_LOCK:
        _TWOFA_SESSIONS[session_id] = {
            "queue": q,
            "cancelled": False,
            "created_at": time.time()
        }
    return q


def deliver_2fa_response(session_id: str, response_data: Dict[str, Any]) -> bool:
    """Distribue la réponse 2FA (code OTP ou validation smartphone) à la tâche en attente."""
    with _TWOFA_LOCK:
        session = _TWOFA_SESSIONS.get(session_id)
        if session:
            session["queue"].put(response_data)
            if response_data.get("response_type") == "cancel":
                session["cancelled"] = True
            return True
    return False


def is_2fa_session_cancelled(session_id: str) -> bool:
    """Vérifie si la session 2FA a été annulée par l'utilisateur."""
    with _TWOFA_LOCK:
        sess = _TWOFA_SESSIONS.get(session_id)
        return bool(sess and sess.get("cancelled"))


def unregister_2fa_session(session_id: str):
    """Nettoie la session 2FA."""
    with _TWOFA_LOCK:
        _TWOFA_SESSIONS.pop(session_id, None)


ACCOUNT_TYPE_LABELS = {
    1: "Compte courant",
    2: "Livret / Épargne",
    3: "Dépôt",
    4: "Prêt / Emprunt",
    5: "Compte Titres",
    6: "Compte Joint",
    7: "Carte",
    8: "Assurance-Vie",
    9: "Épargne Salariale (PEE)",
    10: "PERCO",
    13: "PEA",
    17: "Prêt Immobilier",
    18: "Crédit Consommation",
    23: "LDDS",
    24: "PEL",
    25: "CSL",
    26: "CEL",
    28: "Livret A",
    29: "Livret B",
}


def _clean_str(val, default=None) -> Optional[str]:
    """Nettoie les valeurs spéciales Woob (NotLoaded, NotAvailable) vers str propre ou None."""
    if val is None:
        return default
    s = str(val).strip()
    if not s or s in ("NotLoaded", "NotAvailable", "<NotLoaded>"):
        return default
    return s


def _format_account_type(acc_type) -> str:
    """Traduit les codes types Woob en libellés français clairs."""
    if isinstance(acc_type, int) and acc_type in ACCOUNT_TYPE_LABELS:
        return ACCOUNT_TYPE_LABELS[acc_type]
    s = _clean_str(acc_type, "Compte")
    if s.isdigit() and int(s) in ACCOUNT_TYPE_LABELS:
        return ACCOUNT_TYPE_LABELS[int(s)]
    return s


def clean_error_message(e: Exception) -> str:
    """Fournit un message d'erreur clair et lisible pour l'UI, évitant les chaînes vides ou obscures."""
    msg = str(e).strip() if e else ""
    exc_name = type(e).__name__ if e else "UnknownException"

    if not msg or msg in ("{}", "''", '""', "None"):
        if exc_name == "NeedInteractiveFor2FA":
            return "Authentification forte requise : veuillez lancer la synchronisation depuis l'application pour valider l'accès sur votre smartphone."
        elif exc_name in ("AppValidation", "DecoupledValidation"):
            return "Validation sur l'application mobile requise par votre banque."
        elif exc_name == "BrowserIncorrectPassword":
            return "Identifiant ou mot de passe bancaire incorrect."
        elif exc_name in ("BrowserUnavailable", "ActionNeeded"):
            return "Action requise sur le site ou l'application mobile de votre banque."
        elif exc_name in ("AppValidationExpired", "AppValidationCancelled"):
            return "La validation sur votre application bancaire a expiré ou a été annulée."
        elif exc_name in ("ModuleLoadError", "NoModuleException"):
            return "Le module bancaire n'a pas pu être chargé."
        elif exc_name == "FormNotFound":
            return "Formulaire d'authentification introuvable. Votre banque peut demander une action préalable sur son application mobile ou bloquer temporairement les accès automatisés."
        return f"Erreur de communication avec la banque ({exc_name})."

    # Nettoyage des motifs d'erreurs récurrents
    if "FormNotFound" in msg or exc_name == "FormNotFound":
        return "Formulaire d'authentification introuvable. Votre banque peut demander une action préalable sur son application mobile (nouvelles CGU, confirmation SécuriPass) ou bloquer temporairement les accès automatisés."
    if "BrowserIncorrectPassword" in msg or "bad login" in msg.lower():
        return "Identifiant ou mot de passe bancaire incorrect."
    if "ActionNeeded" in msg or exc_name == "ActionNeeded":
        return "Action requise sur le site ou l'application mobile de votre banque (ex: acceptation de nouvelles CGU ou mise à jour de sécurité)."
    if "BrowserUnavailable" in msg:
        return "Le serveur de votre banque est temporairement indisponible."
    if "AppValidationCancelled" in msg or "Authentification annulée" in msg:
        return "Validation 2FA annulée."
    if "AppValidationExpired" in msg or "Session 2FA expirée" in msg:
        return "Le délai de validation sur votre application bancaire a expiré."
    if "NeedInteractiveFor2FA" in msg or exc_name == "NeedInteractiveFor2FA":
        return "Authentification forte requise : veuillez lancer la synchronisation depuis l'application pour valider l'accès sur votre smartphone."
    if "DecoupledValidation" in msg or "AppValidation" in msg or exc_name in ("DecoupledValidation", "AppValidation"):
        return f"Validation sur l'application mobile requise par votre banque : {msg}" if msg and msg not in ("{}", "''", '""', "None") else "Validation sur l'application mobile requise par votre banque."
    if ("element" in msg.lower() and "not found" in msg.lower()) or "clientid" in msg.lower() or exc_name == "ElementNotFound":
        return (
            f"Action requise sur votre espace bancaire : un écran intermédiaire (nouvelles CGU à accepter, validation SécuriPass mobile ou confirmation de coordonnées) bloque l'accès automatisé. Connectez-vous sur le site ou l'application de votre banque pour débloquer l'accès. (Détail : {msg})"
        )

    return msg


class BankSyncService:
    @staticmethod
    def test_connection_and_list_accounts(
        backend_name: str,
        credentials: Dict[str, Any],
        session_id: Optional[str] = None,
        event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None
    ) -> List[RemoteAccountOut]:
        """
        Teste les identifiants et liste les comptes distants disponibles (courants, livrets, etc.).
        Gère les flux 2FA interactifs si un session_id et event_callback sont fournis.
        """
        w = get_woob()
        # Assurer l'installation du module si nécessaire
        try:
            w.repositories.install(backend_name)
        except Exception as e:
            logger.debug(f"[BankSync] Module install notice: {e}")

        # Appliquer les correctifs si nécessaire
        _apply_module_hotfixes(w, backend_name)

        # Nettoyage des credentials : suppression des valeurs vides
        clean_creds = {k: v for k, v in credentials.items() if v is not None and v != ""}
        if session_id:
            clean_creds["request_information"] = {}

        backend_instance_name = f"test_{backend_name}_{int(time.time())}"
        backend = w.load_backend(
            backend_name,
            backend_instance_name,
            params=clean_creds,
            storage=None
        )

        # Ré-application du hotfix ciblé sur l'instance backend et ses classes chargées
        _apply_module_hotfixes(w, backend_name, backend=backend)

        if session_id:
            if "request_information" in backend.config:
                backend.config["request_information"].set({})
            if hasattr(backend, "browser"):
                backend.browser.is_interactive = True

        def _do_fetch_accounts():
            raw_accounts = list(backend.iter_accounts())
            result = []
            for acc in raw_accounts:
                label = _clean_str(getattr(acc, "label", None), "Compte sans nom")
                acc_id = _clean_str(getattr(acc, "id", None), "")
                acc_type = _format_account_type(getattr(acc, "type", 1))
                
                raw_bal = getattr(acc, "balance", 0.0)
                try:
                    balance = float(raw_bal) if _clean_str(raw_bal) is not None else 0.0
                except (ValueError, TypeError):
                    balance = 0.0

                currency = _clean_str(getattr(acc, "currency", None), "EUR")
                iban = _clean_str(getattr(acc, "iban", None), None)

                result.append(RemoteAccountOut(
                    id=acc_id,
                    label=label,
                    type=acc_type,
                    balance=balance,
                    currency=currency,
                    iban=iban
                ))
            return result

        app_val_attempts = 0
        while True:
            try:
                return _do_fetch_accounts()
            except NeedInteractiveFor2FA:
                if not session_id or not event_callback:
                    raise Exception("Authentification interactive 2FA requise par votre banque.")
                if "request_information" in backend.config:
                    backend.config["request_information"].set({})
                if hasattr(backend, "browser"):
                    backend.browser.is_interactive = True
                continue

            except (AppValidation, DecoupledValidation) as av:
                if not session_id or not event_callback:
                    raise Exception("Authentification mobile requise sur votre application bancaire (SCA).")
                app_val_attempts += 1
                if app_val_attempts > 5:
                    raise Exception("Délai d'attente de validation mobile dépassé.")
                # Émettre l'événement 2FA vers l'UI
                event_callback("2fa_required", {
                    "type": "app_validation",
                    "auto_poll": True,
                    "message": str(av) or getattr(av, "message", None) or "Veuillez valider la notification sur votre application mobile bancaire."
                })
                if event_callback:
                    event_callback("progress", {"step": "2fa_checking", "message": "En attente de validation sur votre smartphone (détection automatique)..."})
                # Déclencher immédiatement la reprise/polling Woob sans bloquer l'utilisateur sur le PC
                if "resume" in backend.config:
                    backend.config["resume"].set(True)
                if hasattr(backend, "browser") and hasattr(backend.browser, "check_interactive"):
                    backend.browser.check_interactive()
                if is_2fa_session_cancelled(session_id):
                    raise Exception("Authentification annulée par l'utilisateur.")
                continue

            except (BrowserQuestion, OTPQuestion, SentOTPQuestion) as bq:
                if not session_id or not event_callback:
                    raise Exception("Code de sécurité (SMS/Email) requis par votre banque.")
                msg = getattr(bq, "message", None)
                if not msg and hasattr(bq, "fields") and bq.fields:
                    msg = getattr(bq.fields[0], "label", None)
                if not msg:
                    msg = "Veuillez entrer le code de sécurité reçu par SMS ou Email."
                event_callback("2fa_required", {
                    "type": "otp_code",
                    "message": msg
                })
                q = _TWOFA_SESSIONS.get(session_id, {}).get("queue")
                if not q:
                    raise Exception("Session 2FA expirée.")
                resp = q.get(timeout=120)
                if resp.get("response_type") == "cancel":
                    raise Exception("Authentification annulée par l'utilisateur.")
                otp_val = resp.get("value", "").strip()
                if not otp_val:
                    raise Exception("Aucun code fourni.")
                # Injecter le code dans la config du backend
                field_id = None
                if hasattr(bq, "fields") and bq.fields:
                    field_id = getattr(bq.fields[0], "id", None)
                if field_id and field_id in backend.config:
                    backend.config[field_id].set(otp_val)
                elif "code" in backend.config:
                    backend.config["code"].set(otp_val)
                elif "otp" in backend.config:
                    backend.config["otp"].set(otp_val)
                elif "email_code" in backend.config:
                    backend.config["email_code"].set(otp_val)
                continue

            except BrowserIncorrectPassword:
                raise Exception("Identifiant ou mot de passe bancaire incorrect.")
            except Exception as e:
                logger.error(f"[BankSync] Erreur lors de l'appel bancaire {backend_name} : {e}")
                raise Exception(clean_error_message(e))

    @staticmethod
    def fetch_preview_transactions(
        db: Session,
        connection: BankConnection,
        master_password: str,
        since_days: int = 90,
        event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Récupère les transactions distantes sans les enregistrer, et calcule les correspondances
        de rapprochement (déjà rapprochées, à rapprocher, à ajouter) pour prévisualisation dans la modale.
        """
        from app.routers.csv_parser import check_reconciliation

        if not master_password:
            raise Exception("Coffre-fort verrouillé : veuillez déverrouiller votre coffre pour synchroniser vos comptes.")

        if not CredentialVault.has_credentials(db, connection.id):
            raise Exception("Aucun identifiant configuré pour cette connexion bancaire.")

        creds = CredentialVault.retrieve_credentials(db, connection.id, master_password)
        if not creds:
            raise Exception("Mot de passe maître incorrect : impossible de déchiffrer les identifiants.")

        mapping = {}
        if connection.account_mapping:
            try:
                mapping = json.loads(connection.account_mapping)
            except Exception:
                mapping = {}

        if not mapping:
            raise Exception("Aucun compte OmniBank n'est associé à cette connexion. Veuillez configurer le mapping.")

        w = get_woob()
        backend_name = connection.backend
        backend_instance_name = f"preview_{backend_name}_{connection.id}_{int(time.time())}"

        _apply_module_hotfixes(w, backend_name)

        clean_creds = {k: v for k, v in creds.items() if v is not None and v != ""}
        if session_id:
            clean_creds["request_information"] = {}

        backend = w.load_backend(
            backend_name,
            backend_instance_name,
            params=clean_creds,
            storage=None
        )

        # Ré-application du hotfix ciblé sur l'instance backend et ses classes chargées
        _apply_module_hotfixes(w, backend_name, backend=backend)

        if session_id:
            if "request_information" in backend.config:
                backend.config["request_information"].set({})
            if hasattr(backend, "browser"):
                backend.browser.is_interactive = True

        if event_callback:
            event_callback("progress", {"step": "auth", "message": "Connexion sécurisée à la banque..."})

        # Gestion 2FA
        app_val_attempts = 0
        def _get_accounts_with_2fa():
            nonlocal app_val_attempts
            while True:
                try:
                    return list(backend.iter_accounts())
                except NeedInteractiveFor2FA:
                    if not session_id or not event_callback:
                        raise Exception("Authentification interactive 2FA requise par votre banque.")
                    if "request_information" in backend.config:
                        backend.config["request_information"].set({})
                    if hasattr(backend, "browser"):
                        backend.browser.is_interactive = True
                    continue
                except (AppValidation, DecoupledValidation) as av:
                    if not session_id or not event_callback:
                        raise Exception("Authentification mobile requise sur votre application bancaire (SCA).")
                    app_val_attempts += 1
                    if app_val_attempts > 5:
                        raise Exception("Délai d'attente de validation mobile dépassé.")
                    event_callback("2fa_required", {
                        "type": "app_validation",
                        "auto_poll": True,
                        "message": str(av) or getattr(av, "message", None) or "Veuillez valider la connexion sur votre application bancaire mobile."
                    })
                    if event_callback:
                        event_callback("progress", {"step": "2fa_checking", "message": "En attente de confirmation sur votre smartphone (détection automatique)..."})
                    if "resume" in backend.config:
                        backend.config["resume"].set(True)
                    if hasattr(backend, "browser") and hasattr(backend.browser, "check_interactive"):
                        backend.browser.check_interactive()
                    if is_2fa_session_cancelled(session_id):
                        raise Exception("Authentification annulée par l'utilisateur.")
                    continue
                except (BrowserQuestion, OTPQuestion, SentOTPQuestion) as bq:
                    if not session_id or not event_callback:
                        raise Exception("Code SMS/Email requis par votre banque.")
                    msg = getattr(bq, "message", None)
                    if not msg and hasattr(bq, "fields") and bq.fields:
                        msg = getattr(bq.fields[0], "label", None)
                    if not msg:
                        msg = "Entrez le code de sécurité reçu."
                    event_callback("2fa_required", {
                        "type": "otp_code",
                        "message": msg
                    })
                    q = _TWOFA_SESSIONS.get(session_id, {}).get("queue")
                    if not q:
                        raise Exception("Session 2FA expirée.")
                    resp = q.get(timeout=120)
                    if resp.get("response_type") == "cancel":
                        raise Exception("Authentification annulée.")
                    otp_val = resp.get("value", "").strip()
                    if not otp_val:
                        raise Exception("Aucun code fourni.")
                    field_id = None
                    if hasattr(bq, "fields") and bq.fields:
                        field_id = getattr(bq.fields[0], "id", None)
                    if field_id and field_id in backend.config:
                        backend.config[field_id].set(otp_val)
                    elif "code" in backend.config:
                        backend.config["code"].set(otp_val)
                    elif "otp" in backend.config:
                        backend.config["otp"].set(otp_val)
                    elif "email_code" in backend.config:
                        backend.config["email_code"].set(otp_val)
                    continue

        raw_accounts = _get_accounts_with_2fa()
        cutoff_date = date.today() - timedelta(days=since_days)

        matched_ids_global = set()
        accounts_preview = []
        from app.services.finance_engine import calculate_balances
        balances_reconciled = calculate_balances(db, only_reconciled=True)

        for acc in raw_accounts:
            remote_id = _clean_str(getattr(acc, "id", None), "")
            if remote_id not in mapping:
                continue

            local_account_id = mapping[remote_id]
            local_acc = db.query(Account).filter(Account.id == local_account_id).first()
            if not local_acc:
                continue

            acc_label = _clean_str(getattr(acc, "label", None), remote_id)

            raw_bal = getattr(acc, "balance", None)
            try:
                bank_balance = float(raw_bal) if _clean_str(raw_bal) is not None else None
            except (ValueError, TypeError):
                bank_balance = None

            local_reconciled_bal = round(balances_reconciled.get(local_acc.id, local_acc.initial_balance or 0.0), 2)

            if event_callback:
                event_callback("progress", {
                    "step": "sync_account",
                    "account": acc_label,
                    "message": f"Récupération des opérations de [{acc_label}]..."
                })

            history_raw = []
            try:
                for tx in backend.iter_history(acc):
                    tx_date = getattr(tx, "date", None)
                    if hasattr(tx_date, "date"):
                        tx_date = tx_date.date()
                    elif isinstance(tx_date, datetime):
                        tx_date = tx_date.date()
                    elif isinstance(tx_date, str):
                        try:
                            tx_date = datetime.strptime(tx_date[:10], "%Y-%m-%d").date()
                        except Exception:
                            continue

                    if not tx_date or tx_date < cutoff_date:
                        continue

                    raw_amount = float(getattr(tx, "amount", 0.0) or 0.0)
                    amount = abs(raw_amount)
                    tx_label = (getattr(tx, "label", "") or "Opération bancaire").strip()

                    raw_hash = hashlib.sha256(f"{connection.backend}_{remote_id}_{tx_date}_{raw_amount}_{tx_label}".encode("utf-8")).hexdigest()[:12]
                    csv_id = f"woob_{connection.backend}_{remote_id}_{raw_hash}"

                    history_raw.append({
                        "date_operation": tx_date.isoformat(),
                        "tx_date_obj": tx_date,
                        "description": tx_label,
                        "raw_description": tx_label,
                        "amount": amount,
                        "raw_amount": raw_amount,
                        "csv_id": csv_id,
                        "account_id": local_acc.id,
                        "account_name": local_acc.name,
                        "remote_id": remote_id,
                        "is_coming": False
                    })
            except Exception as hist_err:
                logger.warning(f"[BankSync] Erreur lecture historique de {acc_label}: {hist_err}")

            coming_raw = []
            # Récupération des opérations à venir (cartes à débit immédiat en attente, prélèvements programmés)
            try:
                for tx in backend.iter_coming(acc):
                    tx_date = getattr(tx, "date", None)
                    if hasattr(tx_date, "date"):
                        tx_date = tx_date.date()
                    elif isinstance(tx_date, datetime):
                        tx_date = tx_date.date()
                    elif isinstance(tx_date, str):
                        try:
                            tx_date = datetime.strptime(tx_date[:10], "%Y-%m-%d").date()
                        except Exception:
                            tx_date = date.today()

                    if not tx_date:
                        tx_date = date.today()

                    raw_amount = float(getattr(tx, "amount", 0.0) or 0.0)
                    amount = abs(raw_amount)
                    tx_label = (getattr(tx, "label", "") or "Opération à venir").strip()

                    raw_hash = hashlib.sha256(f"{connection.backend}_{remote_id}_{tx_date}_{raw_amount}_{tx_label}".encode("utf-8")).hexdigest()[:12]
                    csv_id = f"woob_coming_{connection.backend}_{remote_id}_{raw_hash}"

                    coming_raw.append({
                        "date_operation": tx_date.isoformat(),
                        "tx_date_obj": tx_date,
                        "description": tx_label,
                        "raw_description": tx_label,
                        "amount": amount,
                        "raw_amount": raw_amount,
                        "csv_id": csv_id,
                        "account_id": local_acc.id,
                        "account_name": local_acc.name,
                        "remote_id": remote_id,
                        "is_coming": True
                    })
            except Exception as coming_err:
                logger.debug(f"[BankSync] iter_coming non supporté ou ignoré pour {acc_label}: {coming_err}")

            parsed_txs = []

            # ── PASSE 1 : Matching des opérations confirmées (historique) en priorité ──
            for item in history_raw:
                tx_date = item["tx_date_obj"]
                raw_amount = item["raw_amount"]
                rec_info = check_reconciliation(
                    db,
                    tx_date,
                    raw_amount,
                    matched_ids=matched_ids_global,
                    account_id=local_acc.id,
                    is_coming=False,
                    bank_label=item.get("raw_description") or item.get("description"),
                    csv_id=item.get("csv_id")
                )
                is_reconciled = False
                already_reconciled = False
                is_mirror = False
                is_orphan_link = False
                orphan_acc_id = None
                orphan_acc_name = None
                matched_id = None
                db_desc = None
                match_score = 0

                if rec_info:
                    is_reconciled = True
                    already_reconciled = rec_info.get("already_reconciled", False)
                    is_mirror = rec_info.get("is_mirror_transfer", False)
                    is_orphan_link = rec_info.get("is_orphan_transfer_link", False)
                    orphan_acc_id = rec_info.get("orphan_account_id")
                    orphan_acc_name = rec_info.get("orphan_account_name")
                    matched_id = rec_info.get("id")
                    db_desc = rec_info.get("description")
                    match_score = rec_info.get("match_score", 0)
                    if matched_id:
                        matched_ids_global.add(matched_id)

                parsed_txs.append({
                    "date_operation": item["date_operation"],
                    "description": item["description"],
                    "raw_description": item["raw_description"],
                    "amount": item["amount"],
                    "raw_amount": raw_amount,
                    "is_reconciled": is_reconciled,
                    "already_reconciled": already_reconciled,
                    "is_mirror_transfer": is_mirror,
                    "is_orphan_transfer_link": is_orphan_link,
                    "orphan_account_id": orphan_acc_id,
                    "orphan_account_name": orphan_acc_name,
                    "matched_db_id": matched_id,
                    "db_description": db_desc,
                    "match_score": match_score,
                    "category": None,
                    "csv_id": item["csv_id"],
                    "account_id": local_acc.id,
                    "account_name": local_acc.name,
                    "remote_id": remote_id,
                    "is_coming": False
                })

            # ── PASSE 2 : Matching des opérations à venir (en attente bancaire) ──
            for item in coming_raw:
                tx_date = item["tx_date_obj"]
                raw_amount = item["raw_amount"]
                rec_info = check_reconciliation(
                    db,
                    tx_date,
                    raw_amount,
                    matched_ids=matched_ids_global,
                    account_id=local_acc.id,
                    is_coming=True,
                    bank_label=item.get("raw_description") or item.get("description"),
                    csv_id=item.get("csv_id")
                )
                is_reconciled = False
                already_reconciled = False
                is_mirror = False
                is_orphan_link = False
                orphan_acc_id = None
                orphan_acc_name = None
                matched_id = None
                db_desc = None
                match_score = 0

                if rec_info:
                    is_reconciled = True
                    already_reconciled = rec_info.get("already_reconciled", False)
                    is_mirror = rec_info.get("is_mirror_transfer", False)
                    is_orphan_link = rec_info.get("is_orphan_transfer_link", False)
                    orphan_acc_id = rec_info.get("orphan_account_id")
                    orphan_acc_name = rec_info.get("orphan_account_name")
                    matched_id = rec_info.get("id")
                    db_desc = rec_info.get("description")
                    match_score = rec_info.get("match_score", 0)
                    if matched_id:
                        matched_ids_global.add(matched_id)

                parsed_txs.append({
                    "date_operation": item["date_operation"],
                    "description": item["description"],
                    "raw_description": item["raw_description"],
                    "amount": item["amount"],
                    "raw_amount": raw_amount,
                    "is_reconciled": is_reconciled,
                    "already_reconciled": already_reconciled,
                    "is_mirror_transfer": is_mirror,
                    "is_orphan_transfer_link": is_orphan_link,
                    "orphan_account_id": orphan_acc_id,
                    "orphan_account_name": orphan_acc_name,
                    "matched_db_id": matched_id,
                    "db_description": db_desc,
                    "match_score": match_score,
                    "category": None,
                    "csv_id": item["csv_id"],
                    "account_id": local_acc.id,
                    "account_name": local_acc.name,
                    "remote_id": remote_id,
                    "is_coming": True
                })

            # Tri chronologique décroissant des opérations (les plus récentes en premier)
            parsed_txs.sort(key=lambda x: str(x.get("date_operation") or ""), reverse=True)

            accounts_preview.append({
                "remote_id": remote_id,
                "account_id": local_acc.id,
                "account_name": local_acc.name,
                "account_type": local_acc.type,
                "bank_balance": bank_balance,
                "local_reconciled_balance": local_reconciled_bal,
                "transactions": parsed_txs
            })

        # Résolution automatique des libellés et catégories (Smart Label / Règles bancaires / Historique)
        try:
            from app.services.smart_label_service import resolve_smart_labels_batch
            all_raw_labels = []
            for acc in accounts_preview:
                for tx in acc.get("transactions", []):
                    if not tx.get("is_reconciled"):
                        all_raw_labels.append(tx.get("raw_description") or tx.get("description") or "")

            if all_raw_labels:
                resolutions = resolve_smart_labels_batch(db, all_raw_labels)
                for acc in accounts_preview:
                    for tx in acc.get("transactions", []):
                        if not tx.get("is_reconciled"):
                            raw = tx.get("raw_description") or tx.get("description") or ""
                            if raw in resolutions:
                                res = resolutions[raw]
                                if res.get("source") in ("rule", "history"):
                                    tx["description"] = res["description"]
                                    if res.get("category"):
                                        tx["category"] = res["category"]
                                    tx["smart_suggested"] = True
        except Exception as sl_err:
            logger.warning(f"[BankSync] Erreur résolution smart labels: {sl_err}")

        summary = {
            "connection_id": connection.id,
            "connection_label": connection.label,
            "accounts": accounts_preview
        }

        try:
            from app.services.bank_sync_scheduler import save_pending_sync_data
            save_pending_sync_data(db, connection.id, summary)
        except Exception as pend_err:
            logger.warning(f"[BankSync] Erreur enregistrement pending data: {pend_err}")

        if event_callback:
            event_callback("preview_ready", summary)

        return summary

    @staticmethod
    def commit_reviewed_transactions(
        db: Session,
        connection_id: int,
        transactions_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Enregistre et rapproche en base la liste d'opérations validée par l'utilisateur.
        """
        conn = db.query(BankConnection).filter(BankConnection.id == connection_id).first()
        imported = 0
        reconciled_count = 0
        created_ids = []

        # Indexer les csv_id existants en base pour éviter tout doublon
        existing_csv_ids = set(
            row[0] for row in db.query(Transaction.csv_id).filter(Transaction.csv_id.isnot(None)).all()
        )

        # Suivi des comptes vierges pour ajustement rétroactif automatique du solde initial
        distinct_account_ids = set(item.get("account_id") for item in transactions_data if item.get("account_id"))
        account_initial_tx_counts = {}
        for acc_id in distinct_account_ids:
            tx_count = db.query(Transaction).filter(
                (Transaction.from_account_id == acc_id) | (Transaction.to_account_id == acc_id)
            ).count()
            account_initial_tx_counts[acc_id] = tx_count

        account_net_flows = {acc_id: 0.0 for acc_id in distinct_account_ids}

        for item in transactions_data:
            account_id = item.get("account_id")
            if not account_id:
                continue

            is_rec = item.get("is_reconciled", False)
            already_rec = item.get("already_rec", False) or item.get("already_reconciled", False)
            matched_id = item.get("matched_db_id")
            is_coming = bool(item.get("is_coming", False))

            # 1. Si déjà rapproché : on ignore (doublon)
            if is_rec and already_rec:
                continue

            is_orphan_link = item.get("is_orphan_transfer_link", False)
            creator_name = "Import Relevé" if (not conn or connection_id == -1) else "Banque (Sync)"

            # 2. Si liaison de virement orphelin (Auto-linking multi-comptes) :
            if is_rec and matched_id and is_orphan_link:
                existing = db.query(Transaction).filter(Transaction.id == matched_id).first()
                if existing:
                    before_snap = snapshot_entity(existing)
                    raw_amt = float(item.get("raw_amount") if item.get("raw_amount") is not None else (item.get("amount") or 0.0))
                    # Si raw_amt < 0, l'opération courante est le débit (from_account = account_id)
                    # et l'écriture existante était le crédit isolé sur l'autre compte
                    if raw_amt < 0:
                        existing.from_account_id = account_id
                    else:
                        # Si raw_amt > 0, l'opération courante est le crédit (to_account = account_id)
                        # et l'écriture existante était le débit isolé sur l'autre compte
                        existing.to_account_id = account_id

                    existing.type = "transfer"
                    if not is_coming:
                        existing.reconciliation_date = date.today()
                        reconciled_count += 1
                    if item.get("category"):
                        existing.category = item["category"]
                    record_action(db, "transaction", existing.id, "UPDATE", before_snap, snapshot_entity(existing), user_name=f"{creator_name} (Liaison Virement)")
                continue

            # 2.B Si prédiction existante en attente de pointage classique :
            if is_rec and matched_id:
                existing = db.query(Transaction).filter(Transaction.id == matched_id).first()
                if existing:
                    before_snap = snapshot_entity(existing)
                    if not is_coming:
                        existing.reconciliation_date = date.today()
                        reconciled_count += 1
                    if item.get("category"):
                        existing.category = item["category"]
                    csv_id = item.get("csv_id")
                    if csv_id:
                        existing.csv_id = csv_id
                        existing_csv_ids.add(csv_id)
                    record_action(db, "transaction", existing.id, "UPDATE", before_snap, snapshot_entity(existing), user_name=creator_name)
                continue

            # 3. Nouvelle transaction à ajouter :
            csv_id = item.get("csv_id")
            if csv_id and csv_id in existing_csv_ids:
                continue

            raw_amt = float(item.get("raw_amount") if item.get("raw_amount") is not None else (item.get("amount") or 0.0))
            amt = abs(float(item.get("amount", 0.0) or raw_amt))

            if raw_amt < 0:
                t_type = "expense_var"
                from_acc = account_id
                to_acc = None
            else:
                t_type = "income"
                from_acc = None
                to_acc = account_id

            op_date_str = item.get("date_operation") or item.get("date")
            try:
                op_date = datetime.strptime(str(op_date_str)[:10], "%Y-%m-%d").date()
            except Exception:
                op_date = date.today()

            is_coming = bool(item.get("is_coming", False))
            recon_date_val = None
            if item.get("reconciliation_date"):
                try:
                    recon_date_val = datetime.strptime(str(item["reconciliation_date"])[:10], "%Y-%m-%d").date()
                except Exception:
                    recon_date_val = None
            elif not is_coming:
                recon_date_val = date.today()

            new_tx = Transaction(
                csv_id=csv_id,
                date_saisie=date.today(),
                date_operation=op_date,
                description=item.get("description", "Opération bancaire"),
                amount=amt,
                type=t_type,
                category=item.get("category"),
                reconciliation_date=recon_date_val,
                from_account_id=from_acc,
                to_account_id=to_acc,
                attachments=item.get("attachments"),
                check_slip_number=item.get("check_slip_number"),
                created_by=creator_name
            )
            db.add(new_tx)
            db.flush()
            created_ids.append(new_tx.id)
            if csv_id:
                existing_csv_ids.add(csv_id)

            record_action(db, "transaction", new_tx.id, "CREATE", None, snapshot_entity(new_tx), user_name=creator_name)
            imported += 1
            if not is_coming and recon_date_val is not None:
                account_net_flows[account_id] += raw_amt

            # Auto-apprentissage transparent dans la base de connaissances Smart Label
            raw_lbl = item.get("raw_description") or item.get("raw_label") or item.get("description")
            clean_lbl = item.get("description")
            if raw_lbl and clean_lbl:
                try:
                    from app.services.smart_label_service import learn_label_mapping
                    learn_label_mapping(db, raw_label=raw_lbl, clean_description=clean_lbl, category=item.get("category"))
                except Exception as ex_learn:
                    logger.debug(f"[BankSync] Ignoré échec apprentissage smart label: {ex_learn}")
                except Exception as ex_learn:
                    logger.debug(f"[BankSync] Ignoré échec apprentissage smart label: {ex_learn}")

        # Rétro-calcul automatique du solde initial pour les comptes nouvellement alimentés :
        # Pour que Solde Initial + Somme(opérations_importées) == Solde Réel de la banque au départ.
        for acc_id, initial_tx_count in account_initial_tx_counts.items():
            if initial_tx_count == 0 and account_net_flows[acc_id] != 0.0:
                acc = db.query(Account).filter(Account.id == acc_id).first()
                if acc:
                    # Trouver le solde bancaire distant associé à ce compte s'il existe dans le preview
                    # Le solde initial devient : Solde_banque_actuel - Net_des_opérations_importées
                    matching_preview_acc = None
                    # Recherche dans le résumé en mémoire
                    for prev_acc in summary.get("accounts", []) if 'summary' in locals() else []:
                        if prev_acc.get("account_id") == acc_id and prev_acc.get("bank_balance") is not None:
                            matching_preview_acc = prev_acc
                            break

                    if matching_preview_acc and matching_preview_acc.get("bank_balance") is not None:
                        bank_bal = float(matching_preview_acc["bank_balance"])
                        computed_init_bal = round(bank_bal - account_net_flows[acc_id], 2)
                        acc.initial_balance = computed_init_bal
                        logger.info(f"[BankSync] Ajustement rétroactif automatique du solde initial pour le compte '{acc.name}' (id={acc.id}) : {computed_init_bal} €")

        if conn:
            conn.last_sync_at = datetime.now(timezone.utc)
            conn.last_sync_status = "success"
            conn.last_sync_count = imported + reconciled_count
            conn.last_error = None
            from app.models import Notification
            db.query(Notification).filter(
                Notification.type == "bank_sync_error",
                Notification.link_data.like(f'%"conn_id": {conn.id}%')
            ).update({"is_read": True, "is_archived": True}, synchronize_session=False)

        db.commit()
        
        # Invalider le cache et recalculer
        try:
            from app.services.finance_engine import invalidate_cache
            invalidate_cache()
        except Exception:
            pass

        return {
            "imported": imported,
            "reconciled": reconciled_count,
            "total": imported + reconciled_count,
            "created_ids": created_ids
        }

    @staticmethod
    def sync_connection(
        db: Session,
        connection: BankConnection,
        master_password: str,
        since_days: int = 90,
        event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Exécute la synchronisation en mode streaming : extrait les données et les prépare pour la vue.
        """
        preview = BankSyncService.fetch_preview_transactions(
            db=db,
            connection=connection,
            master_password=master_password,
            since_days=since_days,
            event_callback=event_callback,
            session_id=session_id
        )
        
        # Détection des exclusions persistantes et auto-exclusion sur solde conforme
        from app.services.bank_sync_scheduler import get_dismissed_transactions
        dismissed_tx_map = get_dismissed_transactions(db)
        
        for acc in preview.get("accounts", []):
            bank_balance = acc.get("bank_balance")
            local_reconciled_bal = acc.get("local_reconciled_balance")
            is_balance_conformed = False
            if bank_balance is not None and local_reconciled_bal is not None:
                is_balance_conformed = abs(bank_balance - local_reconciled_bal) < 0.005

            for tx_item in acc.get("transactions", []):
                csv_id = tx_item.get("csv_id")
                is_dismissed = bool(csv_id and csv_id in dismissed_tx_map)
                tx_item["is_dismissed"] = is_dismissed
                tx_item["is_auto_dismissed"] = False

                if is_dismissed:
                    tx_item["_excluded"] = True
                elif is_balance_conformed and not tx_item.get("is_reconciled") and not tx_item.get("is_coming"):
                    tx_date_str = tx_item.get("date_operation")
                    if tx_date_str:
                        try:
                            tx_dt = date.fromisoformat(str(tx_date_str)[:10])
                            if tx_dt < date.today() - timedelta(days=15):
                                tx_item["is_auto_dismissed"] = True
                                tx_item["_excluded"] = True
                        except Exception:
                            pass
        return preview


def re_evaluate_preview_data(db: Session, preview_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Re-calcule dynamiquement en direct le statut de rapprochement (is_reconciled, already_reconciled,
    matched_db_id, solde pointé local, etc.) d'un aperçu bancaire par rapport à l'état actuel de la base SQLite.
    Permet à toute opération supprimée ou ajoutée en local de basculer instantanément dans l'aperçu mis en cache.
    Prend en compte les listes 'rejected_matches' et 'force_matches' pour préserver les décisions manuelles de l'utilisateur.
    """
    if not preview_data or "accounts" not in preview_data:
        return preview_data

    from datetime import date, timedelta
    from app.routers.csv_parser import check_reconciliation
    from app.services.finance_engine import calculate_balances
    from app.services.smart_label_service import resolve_smart_labels_batch
    from app.services.bank_sync_scheduler import get_dismissed_transactions

    dismissed_tx_map = get_dismissed_transactions(db)

    # Extraction des overrides utilisateur
    rejected_by_csv = {}
    for rm in (preview_data.get("rejected_matches") or []):
        csv = rm.get("csv_id")
        db_id = rm.get("db_id")
        if csv and db_id:
            try:
                rejected_by_csv.setdefault(csv, set()).add(int(db_id))
            except (ValueError, TypeError):
                pass

    force_by_csv = {}
    for fm in (preview_data.get("force_matches") or []):
        csv = fm.get("csv_id")
        db_id = fm.get("db_id")
        if csv and db_id:
            try:
                force_by_csv[csv] = int(db_id)
            except (ValueError, TypeError):
                pass

    balances_reconciled = calculate_balances(db, only_reconciled=True)
    matched_ids_global = set()

    for acc in preview_data.get("accounts", []):
        local_acc_id = acc.get("account_id")
        if local_acc_id:
            acc["local_reconciled_balance"] = round(balances_reconciled.get(local_acc_id, 0.0), 2)

        bank_bal = acc.get("bank_balance")
        local_bal = acc.get("local_reconciled_balance")
        is_balance_conformed = False
        if bank_bal is not None and local_bal is not None:
            is_balance_conformed = abs(bank_bal - local_bal) < 0.005

        txs = acc.get("transactions", [])
        confirmed_txs = [tx for tx in txs if not tx.get("is_coming", False)]
        coming_txs = [tx for tx in txs if tx.get("is_coming", False)]

        def _evaluate_tx_list(tx_list, is_coming_flag):
            result_list = []
            for tx in tx_list:
                tx_copy = dict(tx)
                tx_copy["is_coming"] = is_coming_flag
                tx_date_str = tx.get("date_operation")
                raw_amount = tx.get("raw_amount")
                csv_id = tx.get("csv_id")

                is_dismissed = bool(csv_id and csv_id in dismissed_tx_map)
                tx_copy["is_dismissed"] = is_dismissed
                tx_copy["is_auto_dismissed"] = False

                # Passe 0 : Forcer le match si spécifié manuellement par l'utilisateur
                if csv_id and csv_id in force_by_csv:
                    forced_db_id = force_by_csv[csv_id]
                    forced_tx = db.query(Transaction).filter(Transaction.id == forced_db_id).first()
                    if forced_tx:
                        tx_copy["is_reconciled"] = True
                        tx_copy["already_reconciled"] = bool(forced_tx.reconciliation_date)
                        tx_copy["is_mirror_transfer"] = False
                        tx_copy["is_orphan_transfer_link"] = False
                        tx_copy["orphan_account_id"] = None
                        tx_copy["orphan_account_name"] = None
                        tx_copy["matched_db_id"] = forced_db_id
                        tx_copy["db_description"] = forced_tx.description
                        matched_ids_global.add(forced_db_id)
                        if is_dismissed:
                            tx_copy["_excluded"] = True
                        result_list.append(tx_copy)
                        continue

                if tx_date_str and raw_amount is not None and local_acc_id:
                    try:
                        tx_date = date.fromisoformat(str(tx_date_str)[:10])
                        local_excluded = set(matched_ids_global)
                        if csv_id and csv_id in rejected_by_csv:
                            local_excluded |= rejected_by_csv[csv_id]

                        rec_info = check_reconciliation(
                            db,
                            tx_date,
                            float(raw_amount),
                            matched_ids=local_excluded,
                            account_id=local_acc_id,
                            is_coming=is_coming_flag,
                            bank_label=tx.get("raw_description") or tx.get("description"),
                            csv_id=csv_id
                        )
                        if rec_info:
                            tx_copy["is_reconciled"] = True
                            tx_copy["already_reconciled"] = rec_info.get("already_reconciled", False)
                            tx_copy["is_mirror_transfer"] = rec_info.get("is_mirror_transfer", False)
                            tx_copy["is_orphan_transfer_link"] = rec_info.get("is_orphan_transfer_link", False)
                            tx_copy["orphan_account_id"] = rec_info.get("orphan_account_id")
                            tx_copy["orphan_account_name"] = rec_info.get("orphan_account_name")
                            tx_copy["matched_db_id"] = rec_info.get("id")
                            tx_copy["db_description"] = rec_info.get("description")
                            tx_copy["match_score"] = rec_info.get("match_score", 0)
                            if rec_info.get("id"):
                                matched_ids_global.add(rec_info.get("id"))
                        else:
                            tx_copy["is_reconciled"] = False
                            tx_copy["already_reconciled"] = False
                            tx_copy["is_mirror_transfer"] = False
                            tx_copy["is_orphan_transfer_link"] = False
                            tx_copy["orphan_account_id"] = None
                            tx_copy["orphan_account_name"] = None
                            tx_copy["matched_db_id"] = None
                            tx_copy["db_description"] = None
                            tx_copy["match_score"] = 0
                    except Exception as err:
                        logger.warning(f"[BankSync] Erreur re-matching preview tx: {err}")
                        tx_copy["is_reconciled"] = False
                        tx_copy["already_reconciled"] = False
                        tx_copy["is_mirror_transfer"] = False
                        tx_copy["is_orphan_transfer_link"] = False
                        tx_copy["orphan_account_id"] = None
                        tx_copy["orphan_account_name"] = None
                        tx_copy["matched_db_id"] = None
                        tx_copy["db_description"] = None
                        tx_copy["match_score"] = 0

                # Auto-exclusion intelligente si solde conforme et ancienne opération non reconnue
                if not tx_copy.get("is_reconciled") and not is_coming_flag and not is_dismissed:
                    if is_balance_conformed and tx_date_str:
                        try:
                            tx_dt = date.fromisoformat(str(tx_date_str)[:10])
                            if tx_dt < date.today() - timedelta(days=15):
                                tx_copy["is_auto_dismissed"] = True
                                tx_copy["_excluded"] = True
                        except Exception:
                            pass

                if is_dismissed:
                    tx_copy["_excluded"] = True

                result_list.append(tx_copy)
            return result_list

        # Passe 1: Transactions confirmées (historique) en priorité
        re_evaluated_confirmed = _evaluate_tx_list(confirmed_txs, is_coming_flag=False)
        # Passe 2: Transactions à venir (en attente en ligne) ensuite
        re_evaluated_coming = _evaluate_tx_list(coming_txs, is_coming_flag=True)

        all_re_evaluated = re_evaluated_confirmed + re_evaluated_coming
        # Tri chronologique décroissant (plus récentes en premier)
        all_re_evaluated.sort(key=lambda x: str(x.get("date_operation") or ""), reverse=True)
        acc["transactions"] = all_re_evaluated

    # Résolution des libellés intelligents pour toutes les opérations qui ne sont plus rapprochées
    raw_labels = []
    for acc in preview_data.get("accounts", []):
        for tx in acc.get("transactions", []):
            if not tx.get("is_reconciled"):
                raw_desc = tx.get("raw_description") or tx.get("description") or ""
                if raw_desc:
                    raw_labels.append(raw_desc)

    if raw_labels:
        try:
            smart_resolutions = resolve_smart_labels_batch(db, raw_labels)
            for acc in preview_data.get("accounts", []):
                for tx in acc.get("transactions", []):
                    if not tx.get("is_reconciled"):
                        raw_desc = tx.get("raw_description") or tx.get("description") or ""
                        tx["raw_description"] = raw_desc
                        if raw_desc in smart_resolutions:
                            res = smart_resolutions[raw_desc]
                            if res.get("source") in ("rule", "history"):
                                tx["description"] = res["description"]
                                tx["smart_suggested"] = True
                                tx["smart_source"] = res["source"]
                                if not tx.get("category") and res.get("category"):
                                    tx["category"] = res["category"]
        except Exception as e:
            logger.debug(f"[BankSync] Smart labels batch resolution error: {e}")

    return preview_data
