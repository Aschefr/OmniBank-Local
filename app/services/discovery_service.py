import socket
import json
import threading
import logging

logger = logging.getLogger(__name__)

UDP_PORT = 8435
DEFAULT_HTTP_PORT = 8434

_discovery_thread = None
_stop_event = threading.Event()

def start_discovery_listener(http_port: int = DEFAULT_HTTP_PORT):
    global _discovery_thread, _stop_event
    if _discovery_thread and _discovery_thread.is_alive():
        return

    _stop_event.clear()

    def listen_loop():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except Exception:
            pass

        try:
            import os
            from app.database import IS_DOCKER
            # Écouter sur 0.0.0.0 uniquement si explicitement activé, en conteneur Docker, ou en mode partagé
            enable_discovery = os.environ.get('OMNIBANK_ENABLE_DISCOVERY', '').lower() == 'true'
            is_shared = False
            try:
                from app.routers.shared_mode import _get_shared_status
                is_shared = _get_shared_status().get("active", False)
            except Exception:
                pass

            bind_ip = '0.0.0.0' if (IS_DOCKER or is_shared or enable_discovery) else '127.0.0.1'
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
            sock.close()

    _discovery_thread = threading.Thread(target=listen_loop, daemon=True, name="OmniBankDiscovery")
    _discovery_thread.start()

def stop_discovery_listener():
    global _stop_event
    _stop_event.set()
