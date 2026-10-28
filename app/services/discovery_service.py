import socket
import json
import threading
import logging

logger = logging.getLogger(__name__)

UDP_PORT = 8435
DEFAULT_HTTP_PORT = 8434

_discovery_thread = None
_stop_event = threading.Event()
_zeroconf_instance = None
_zeroconf_info = None


def _get_primary_lan_ip() -> str:
    """Détecte l'adresse IPv4 locale principale de la machine sur le LAN."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def _start_mdns_service(http_port: int, bind_all: bool):
    """Enregistre le service mDNS (_omnibank._tcp.local.) si zeroconf est installé."""
    global _zeroconf_instance, _zeroconf_info
    if not bind_all or _zeroconf_instance is not None:
        return
    try:
        from zeroconf import Zeroconf, ServiceInfo
        hostname = socket.gethostname()
        lan_ip = _get_primary_lan_ip()
        if lan_ip.startswith("127."):
            return
        desc = {"app": "OmniBank-Local", "hostname": hostname, "port": str(http_port)}
        info = ServiceInfo(
            "_omnibank._tcp.local.",
            f"OmniBank ({hostname})._omnibank._tcp.local.",
            addresses=[socket.inet_aton(lan_ip)],
            port=http_port,
            properties=desc,
            server=f"{hostname}.local.",
        )
        zc = Zeroconf()
        zc.register_service(info)
        _zeroconf_instance = zc
        _zeroconf_info = info
        logger.info(f"[Discovery] Annonce mDNS _omnibank._tcp.local. active sur {lan_ip}:{http_port}")
    except ImportError:
        logger.debug("[Discovery] Bibliothèque zeroconf absente — découverte UDP active uniquement.")
    except Exception as e:
        logger.debug(f"[Discovery] Annonce mDNS non démarrée: {e}")


def _stop_mdns_service():
    global _zeroconf_instance, _zeroconf_info
    if _zeroconf_instance is not None:
        try:
            if _zeroconf_info is not None:
                _zeroconf_instance.unregister_service(_zeroconf_info)
            _zeroconf_instance.close()
        except Exception:
            pass
        finally:
            _zeroconf_instance = None
            _zeroconf_info = None


def start_discovery_listener(http_port: int = DEFAULT_HTTP_PORT):
    global _discovery_thread, _stop_event
    if _discovery_thread and _discovery_thread.is_alive():
        return

    _stop_event.clear()

    def listen_loop():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except OSError as e:
            logger.debug(f"[Discovery] SO_REUSEADDR non supporté: {e}")

        try:
            import os
            from app.database import IS_DOCKER
            # Écouter sur 0.0.0.0 uniquement si explicitement activé, en conteneur Docker, ou en mode partagé
            enable_discovery = os.environ.get('OMNIBANK_ENABLE_DISCOVERY', '').lower() == 'true'
            is_shared = False
            try:
                from app.routers.shared_mode import _get_shared_status
                is_shared = _get_shared_status().get("active", False)
            except Exception as e:
                logger.debug(f"[Discovery] Impossible de lire le statut partagé: {e}")

            bind_all = bool(IS_DOCKER or is_shared or enable_discovery)
            bind_ip = '0.0.0.0' if bind_all else '127.0.0.1'
            _start_mdns_service(http_port, bind_all)

            sock.bind((bind_ip, UDP_PORT))
            sock.settimeout(1.0)
            logger.info(f"[Discovery] Service de détection réseau actif sur {bind_ip}:{UDP_PORT}")
            while not _stop_event.is_set():
                try:
                    data, addr = sock.recvfrom(1024)
                    msg = data.decode('utf-8', errors='ignore').strip()
                    if "OMNIBANK" in msg.upper() or "DISCOVER" in msg.upper() or "PING" in msg.upper():
                        hostname = socket.gethostname()
                        resp = json.dumps({
                            "app": "OmniBank-Local",
                            "port": http_port,
                            "hostname": hostname,
                            "ip": addr[0]
                        }).encode('utf-8')
                        sock.sendto(resp, addr)
                except socket.timeout:
                    continue
                except Exception as e:
                    logger.debug(f"[Discovery] Reçue exception bénigne: {e}")
        except Exception as e:
            logger.warning(f"[Discovery] Impossible de binder le port UDP {UDP_PORT}: {e}")
        finally:
            _stop_mdns_service()
            sock.close()

    _discovery_thread = threading.Thread(target=listen_loop, daemon=True, name="OmniBankDiscovery")
    _discovery_thread.start()


def stop_discovery_listener():
    global _stop_event
    _stop_event.set()
    _stop_mdns_service()
