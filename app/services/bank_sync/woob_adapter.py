"""
OmniBank-Local — Adaptateur Woob & Gestionnaire de Hotfixes.
Gère l'instance unique Woob, la découverte des modules bancaires,
l'application des correctifs spécifiques (Crédit Agricole, BoursoBank) et le formatage des erreurs.
"""

import importlib
import logging
import os
import pathlib
import sys
import threading
import time
from typing import Any, List, Optional

from woob.core import Woob
from woob.tools.storage import StandardStorage

from app.database import DATA_DIR
from app.schemas.bank_sync_schemas import (
    BackendConfigField,
    BankBackendInfo,
)

logger = logging.getLogger(__name__)

# Cache singleton pour l'instance Woob et son stockage persistant
_WOOB_INSTANCE: Optional[Woob] = None
_STORAGE_INSTANCE: Optional[StandardStorage] = None
_STORAGE_LOCK = threading.Lock()
_BACKENDS_CACHE: Optional[List[BankBackendInfo]] = None
_CACHE_TIMESTAMP: float = 0


def get_woob() -> Woob:
    """Retourne une instance Woob réutilisable."""
    global _WOOB_INSTANCE
    if _WOOB_INSTANCE is None:
        _WOOB_INSTANCE = Woob()
    return _WOOB_INSTANCE


def get_woob_storage() -> StandardStorage:
    """Retourne une instance StandardStorage persistante pour conserver les sessions et cookies 2FA (90 jours)."""
    global _STORAGE_INSTANCE
    with _STORAGE_LOCK:
        if _STORAGE_INSTANCE is None:
            storage_path = os.path.join(DATA_DIR, "woob_storage.json")
            _STORAGE_INSTANCE = StandardStorage(storage_path)
    return _STORAGE_INSTANCE


def _apply_module_hotfixes(w: Woob, backend_name: str, backend: Any = None):
    """Applique les correctifs de compatibilité connus sur les modules Woob si nécessaire."""
    # S'assurer que le module requis est bien installé localement avant d'appliquer un correctif
    try:
        w.repositories.install(backend_name)
    except Exception as e:
        logger.debug(f"[BankSync] Module install check notice ({backend_name}): {e}")

    if backend_name == "boursorama":
        try:
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
                        except Exception as ex_cid:
                            logger.debug(f"[BankSync] Notice extraction client_id: {ex_cid}")
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
                except (ImportError, ModuleNotFoundError):
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

            # Hotfix mémoire KeypadPage pour Crédit Agricole : détection d'interruption de service vs action requise
            if pages_mod and hasattr(pages_mod, "KeypadPage"):
                cls_keypad = pages_mod.KeypadPage
                if not getattr(cls_keypad, "_cragr_keypad_inspected_v2", False):
                    orig_build_pwd = cls_keypad.build_password
                    def make_patched_build_password(orig_fn):
                        def patched_build_password(self, password):
                            status_code = getattr(getattr(self, "response", None), "status_code", 200)
                            from woob.exceptions import BrowserUnavailable, ActionNeeded

                            # 1. Erreur serveur HTTP (500, 502, 503, 504) -> Interruption de service
                            if status_code in (500, 502, 503, 504):
                                logger.warning(f"[BankSync] [Crédit Agricole] Interruption de service bancaire (HTTP {status_code})")
                                raise BrowserUnavailable(f"Le serveur du Crédit Agricole est temporairement indisponible ou en maintenance (HTTP {status_code}).")

                            if isinstance(self.doc, dict) and "keys_layout" not in self.doc:
                                raw_text = getattr(getattr(self, "response", None), "text", "") or ""
                                logger.warning(f"[BankSync] [Crédit Agricole] Clavier absent (status={status_code}): {self.doc or raw_text[:200]}")

                                # 2. Réponse vide ou contenant des termes de maintenance/panne -> Interruption de service
                                combined_lower = f"{str(self.doc)} {raw_text}".lower()
                                is_outage = (
                                    not self.doc
                                    or any(k in combined_lower for k in (
                                        "maintenance", "indisponible", "incident", "interruption",
                                        "temporairement", "unavailable", "bad gateway", "erreur technique",
                                        "momentan", "panne", "service_unavailable"
                                    ))
                                )
                                if is_outage:
                                    raise BrowserUnavailable(
                                        "Interruption temporaire du service bancaire : les serveurs du Crédit Agricole semblent actuellement indisponibles ou en cours de maintenance. Veuillez réessayer plus tard."
                                    )

                                # 3. Réponse contenant une demande d'action utilisateur
                                detail = (
                                    self.doc.get("message")
                                    or self.doc.get("error_description")
                                    or self.doc.get("error")
                                    or self.doc.get("title")
                                    or self.doc.get("detail")
                                )
                                msg_detail = f" ({detail})" if detail else ""
                                raise ActionNeeded(
                                    f"Action requise sur votre espace bancaire : un écran intermédiaire{msg_detail} bloque l'accès automatisé. Connectez-vous sur le site ou l'application de votre banque pour débloquer l'accès."
                                )
                            return orig_fn(self, password)
                        return patched_build_password
                    cls_keypad.build_password = make_patched_build_password(orig_build_pwd)
                    cls_keypad._cragr_keypad_inspected_v2 = True
                    logger.info("[BankSync] Hotfix mémoire Crédit Agricole (KeypadPage inspection v2) appliqué avec succès.")

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
                    except (OSError, IOError) as e:
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

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


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
    except Exception as e:
        logger.debug(f"[BankSync] Erreur inspection champs {module_name}: {e}")
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
    """Fournit un message d'erreur clair et lisible pour l'UI, différenciant panne/maintenance et action requise."""
    msg = str(e).strip() if e else ""
    exc_name = type(e).__name__ if e else "UnknownException"
    msg_lower = msg.lower()

    # 1. Détection prioritaire : Interruption de service bancaire / Panne serveur / Maintenance
    is_outage = (
        exc_name in ("BrowserUnavailable", "ServerMaintenance")
        or "browserunavailable" in msg_lower
        or "servermaintenance" in msg_lower
        or "service unavailable" in msg_lower
        or "service temporar" in msg_lower
        or "temporairement indisponible" in msg_lower
        or "momentanément indisponible" in msg_lower
        or "actuellement indisponible" in msg_lower
        or "interruption temporaire du service" in msg_lower
        or "interruption de service" in msg_lower
        or ("interruption" in msg_lower and any(k in msg_lower for k in ("service", "banque", "serveur")))
        or "bad gateway" in msg_lower
        or "gateway timeout" in msg_lower
        or "502" in msg_lower or "503" in msg_lower or "504" in msg_lower
        or "maintenance" in msg_lower
        or "incident technique" in msg_lower
        or "panne" in msg_lower
        or "connection refused" in msg_lower
        or "connection reset" in msg_lower
    )
    if is_outage:
        if "crédit agricole" in msg_lower or "cragr" in msg_lower:
            return "Interruption temporaire du service bancaire : les serveurs du Crédit Agricole semblent actuellement indisponibles ou en cours de maintenance. Veuillez réessayer plus tard."
        return "Interruption temporaire du service bancaire : le serveur de votre banque est actuellement indisponible ou en maintenance. Veuillez réessayer plus tard."

    # 2. Cas de message vide ou générique
    if not msg or msg in ("{}", "''", '""', "None"):
        if exc_name == "NeedInteractiveFor2FA":
            return "Authentification forte requise : veuillez lancer la synchronisation depuis l'application pour valider l'accès sur votre smartphone."
        elif exc_name in ("AppValidation", "DecoupledValidation"):
            return "Validation sur l'application mobile requise par votre banque."
        elif exc_name == "BrowserIncorrectPassword":
            return "Identifiant ou mot de passe bancaire incorrect."
        elif exc_name == "ActionNeeded":
            return "Action requise sur le site ou l'application mobile de votre banque."
        elif exc_name in ("AppValidationExpired", "AppValidationCancelled"):
            return "La validation sur votre application bancaire a expiré ou a été annulée."
        elif exc_name in ("ModuleLoadError", "NoModuleException"):
            return "Le module bancaire n'a pas pu être chargé."
        elif exc_name == "FormNotFound":
            return "Formulaire d'authentification introuvable. Votre banque peut demander une action préalable sur son application mobile ou bloquer temporairement les accès automatisés."
        return f"Erreur de communication avec la banque ({exc_name})."

    # 3. Mot de passe incorrect
    if "BrowserIncorrectPassword" in msg or "bad login" in msg_lower or "identifiant ou mot de passe incorrect" in msg_lower:
        return "Identifiant ou mot de passe bancaire incorrect."

    # 4. Action requise sur l'espace client (CGU, SécuriPass, profil)
    if "ActionNeeded" in msg or exc_name == "ActionNeeded":
        return msg if "Action requise" in msg else "Action requise sur le site ou l'application mobile de votre banque (ex: acceptation de nouvelles CGU ou mise à jour de sécurité)."

    # 5. Formulaire introuvable
    if "FormNotFound" in msg or exc_name == "FormNotFound":
        return "Formulaire d'authentification introuvable. Votre banque peut demander une action préalable sur son application mobile (nouvelles CGU, confirmation SécuriPass) ou bloquer temporairement les accès automatisés."

    # 6. Validations 2FA et sessions
    if "AppValidationCancelled" in msg or "Authentification annulée" in msg:
        return "Validation 2FA annulée."
    if "AppValidationExpired" in msg or "Session 2FA expirée" in msg:
        return "Le délai de validation sur votre application bancaire a expiré."
    if "NeedInteractiveFor2FA" in msg or exc_name == "NeedInteractiveFor2FA":
        return "Authentification forte requise : veuillez lancer la synchronisation depuis l'application pour valider l'accès sur votre smartphone."
    if "DecoupledValidation" in msg or "AppValidation" in msg or exc_name in ("DecoupledValidation", "AppValidation"):
        return f"Validation sur l'application mobile requise par votre banque : {msg}" if msg and msg not in ("{}", "''", '""', "None") else "Validation sur l'application mobile requise par votre banque."

    # 7. Éléments manquants (seulement si non lié à une indisponibilité)
    if ("element" in msg_lower and "not found" in msg_lower) or "clientid" in msg_lower or exc_name == "ElementNotFound":
        return (
            f"Action requise sur votre espace bancaire : un écran intermédiaire (nouvelles CGU à accepter, validation SécuriPass mobile ou confirmation de coordonnées) bloque l'accès automatisé. Connectez-vous sur le site ou l'application de votre banque pour débloquer l'accès. (Détail : {msg})"
        )

    return msg
