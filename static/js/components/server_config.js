// server_config.js - Remote Server & Local Network Auto-Discovery Manager

const ServerConfig = {
    openModal() {
        const modal = document.getElementById('serverConfigModal');
        if (!modal) return;

        const currentUrl = API.getBaseUrl();
        const hostInput = document.getElementById('serverHostInput');
        const portInput = document.getElementById('serverPortInput');
        const statusEl = document.getElementById('serverConfigStatus');
        const discContainer = document.getElementById('discoveredServersContainer');

        if (statusEl) statusEl.style.display = 'none';
        if (discContainer) discContainer.style.display = 'none';

        if (currentUrl) {
            try {
                const parsed = new URL(currentUrl);
                if (hostInput) hostInput.value = parsed.hostname;
                if (portInput) portInput.value = parsed.port || (parsed.protocol === 'https:' ? '443' : '8434');
            } catch (e) {
                if (hostInput) hostInput.value = currentUrl;
            }
        } else {
            if (hostInput) hostInput.value = window.location.hostname || '';
            if (portInput) portInput.value = window.location.port || '8434';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        const modal = document.getElementById('serverConfigModal');
        if (modal) modal.style.display = 'none';
    },

    async testConnection(targetHost, targetPort) {
        const hostInput = document.getElementById('serverHostInput');
        const portInput = document.getElementById('serverPortInput');
        const statusEl = document.getElementById('serverConfigStatus');

        const host = targetHost || (hostInput ? hostInput.value.trim() : '');
        let port = targetPort || (portInput ? portInput.value.trim() : '8434');

        if (!host) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                statusEl.style.color = '#ef4444';
                statusEl.textContent = 'Veuillez saisir une adresse IP ou un nom de domaine.';
            }
            return false;
        }

        let cleanHost = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        let protocol = 'http';
        if (host.startsWith('https://') || port === '443') {
            protocol = 'https';
        }

        const testUrl = `${protocol}://${cleanHost}:${port}`;

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(51, 102, 255, 0.15)';
            statusEl.style.color = 'var(--accent)';
            statusEl.textContent = '⏳ Test de connexion en cours...';
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const fetchFn = window._originalFetch || window.fetch;
            const res = await fetchFn(`${testUrl}/api/version`, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const json = await res.json();
                const ver = json.version || 'Inconnue';
                if (statusEl) {
                    statusEl.style.background = 'rgba(54, 179, 126, 0.15)';
                    statusEl.style.color = 'var(--success)';
                    statusEl.textContent = `✅ Connexion réussie ! Serveur OmniBank v${ver} disponible.`;
                }
                return testUrl;
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (e) {
            if (statusEl) {
                statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
                statusEl.style.color = '#ef4444';
                statusEl.textContent = `❌ Impossible de joindre le serveur (${e.message || 'Délai dépassé'}). Vérifiez l'IP et le port.`;
            }
            return false;
        }
    },

    async saveConnection() {
        const validatedUrl = await this.testConnection();
        if (validatedUrl) {
            API.setBaseUrl(validatedUrl);
            if (typeof showToast === 'function') {
                showToast(`Serveur configuré : ${validatedUrl}`, 'success');
            }
            this.closeModal();
            setTimeout(() => window.location.reload(), 500);
        }
    },

    async getLocalIPSubnets() {
        const subnets = new Set();
        return new Promise((resolve) => {
            try {
                const pc = new RTCPeerConnection({ iceServers: [] });
                pc.createDataChannel('omnibank_discovery');
                pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});

                const finish = () => {
                    try { pc.close(); } catch(e) {}
                    resolve(Array.from(subnets));
                };

                const timer = setTimeout(finish, 800);

                pc.onicecandidate = (event) => {
                    if (!event || !event.candidate || !event.candidate.candidate) {
                        clearTimeout(timer);
                        finish();
                        return;
                    }
                    const cand = event.candidate.candidate;
                    const match = cand.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
                    if (match) {
                        const ip = match[1];
                        if (!ip.startsWith('127.') && !ip.startsWith('0.')) {
                            const prefix = ip.split('.').slice(0, 3).join('.');
                            subnets.add(prefix);
                        }
                    }
                };
            } catch(e) {
                resolve([]);
            }
        });
    },

    async discoverServers() {
        const statusEl = document.getElementById('serverConfigStatus');
        const discContainer = document.getElementById('discoveredServersContainer');
        const discList = document.getElementById('discoveredServersList');

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(51, 102, 255, 0.15)';
            statusEl.style.color = 'var(--accent)';
            statusEl.textContent = '🔍 Détection dynamique des sous-réseaux Wi-Fi en cours...';
        }

        if (discContainer) discContainer.style.display = 'block';
        if (discList) discList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">Recherche d\'instances sur les cartes réseau...</div>';

        const found = [];
        const fetchFn = window._originalFetch || window.fetch;

        // Dynamic candidates: localhost, user input host, active host, WebRTC detected local subnets
        const candidates = ['localhost', '127.0.0.1'];
        const currentHost = window.location.hostname;
        const inputHost = document.getElementById('serverHostInput') ? document.getElementById('serverHostInput').value.trim() : '';

        const addHostAndSubnet = (hostStr) => {
            if (!hostStr) return;
            const clean = hostStr.replace(/^https?:\/\//i, '').replace(/:.*$/, '').replace(/\/.*$/, '').trim();
            if (!clean || candidates.includes(clean)) return;
            candidates.push(clean);

            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
                const parts = clean.split('.');
                const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
                for (let i = 1; i <= 254; i++) {
                    const ip = `${prefix}.${i}`;
                    if (!candidates.includes(ip)) candidates.push(ip);
                }
            } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
                // User typed a prefix (e.g. 192.168.20)
                for (let i = 1; i <= 254; i++) {
                    const ip = `${clean}.${i}`;
                    if (!candidates.includes(ip)) candidates.push(ip);
                }
            }
        };

        addHostAndSubnet(inputHost);
        addHostAndSubnet(currentHost);

        // Dynamically detect local network subnets via WebRTC local ICE candidates
        const detectedSubnets = await this.getLocalIPSubnets();
        detectedSubnets.forEach(prefix => {
            for (let i = 1; i <= 254; i++) {
                const ip = `${prefix}.${i}`;
                if (!candidates.includes(ip)) candidates.push(ip);
            }
        });

        const portInput = document.getElementById('serverPortInput');
        const port = portInput ? (portInput.value.trim() || '8434') : '8434';

        const checkServer = async (ip) => {
            try {
                const controller = new AbortController();
                const tid = setTimeout(() => controller.abort(), 1200);
                const res = await fetchFn(`http://${ip}:${port}/api/version`, { signal: controller.signal });
                clearTimeout(tid);
                if (res.ok) {
                    const json = await res.json();
                    return { ip, port, version: json.version || '?' };
                }
            } catch (e) {}
            return null;
        };

        // Run checks in chunks of 25 concurrent probes
        const chunkSize = 25;
        for (let i = 0; i < candidates.length; i += chunkSize) {
            const batch = candidates.slice(i, i + chunkSize);
            const results = await Promise.all(batch.map(ip => checkServer(ip)));
            results.forEach(r => {
                if (r && !found.some(existing => existing.ip === r.ip && existing.port === r.port)) {
                    found.push(r);
                }
            });
            if (found.length > 0 && i >= 50) break; // Keep scanning a bit even if one found
        }

        if (found.length > 0) {
            if (statusEl) {
                statusEl.style.background = 'rgba(54, 179, 126, 0.15)';
                statusEl.style.color = 'var(--success)';
                statusEl.textContent = `🎉 ${found.length} instance(s) OmniBank détectée(s) !`;
            }
            if (discList) {
                discList.innerHTML = found.map(s => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-base); padding:8px 12px; border-radius:8px; border:1px solid var(--border-color); cursor:pointer;" onclick="window.ServerConfig.selectDiscovered('${s.ip}', ${s.port})">
                        <div>
                            <div style="font-weight:700; font-size:13px; color:var(--text-main);">🖥️ ${s.ip}:${s.port}</div>
                            <div style="font-size:11px; color:var(--text-muted);">OmniBank v${s.version}</div>
                        </div>
                        <button class="btn btn-primary" style="font-size:11px; padding:4px 10px;">Se connecter</button>
                    </div>
                `).join('');
            }
        } else {
            if (statusEl) {
                statusEl.style.background = 'rgba(245, 158, 11, 0.15)';
                statusEl.style.color = '#f59e0b';
                statusEl.textContent = 'Aucun serveur détecté automatiquement. Saisissez l\'IP manuellement.';
            }
            if (discList) {
                discList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">Aucune instance trouvée sur le Wi-Fi local.</div>';
            }
        }
    },

    selectDiscovered(ip, port) {
        const hostInput = document.getElementById('serverHostInput');
        const portInput = document.getElementById('serverPortInput');
        if (hostInput) hostInput.value = ip;
        if (portInput) portInput.value = port;
        this.saveConnection();
    }
};

window.ServerConfig = ServerConfig;
