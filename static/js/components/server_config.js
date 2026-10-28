// server_config.js - Remote Server, Local Network Auto-Discovery & Offline Store Demo Mode

const ServerConfig = {
    _demoState: null,

    isDemoMode() {
        return localStorage.getItem('omnibank_demo_mode') === 'true';
    },

    enableDemoMode() {
        localStorage.setItem('omnibank_demo_mode', 'true');
        localStorage.removeItem('omnibank_server_url');
        this.closeModal();
        window.location.reload();
    },

    disableDemoMode() {
        localStorage.removeItem('omnibank_demo_mode');
        this.openModal({ autoScan: true });
    },

    _ensureDemoBanner() {
        if (!this.isDemoMode() || typeof document === 'undefined') return;
        if (document.getElementById('omniDemoModeBanner')) return;
        const banner = document.createElement('div');
        banner.id = 'omniDemoModeBanner';
        banner.style.cssText = 'background:linear-gradient(90deg,#4f46e5,#0ea5e9);color:#fff;font-size:12px;font-weight:600;padding:6px 14px;display:flex;align-items:center;justify-content:center;gap:12px;z-index:9999;position:relative;';
        banner.innerHTML = `
            <span>✨ Mode Démo Hors-ligne (Données simulées)</span>
            <button onclick="window.ServerConfig.disableDemoMode()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;">Connecter mon serveur</button>
        `;
        document.body.prepend(banner);
    },

    _getDemoState() {
        if (this._demoState) return this._demoState;
        const today = new Date().toISOString().slice(0, 10);
        const ym = today.slice(0, 7);
        this._demoState = {
            accounts: [
                { id: 1, name: 'Compte Courant Principal', initial_balance: 2450.0, current_balance: 3185.5, is_savings: false, is_archived: false, currency: 'EUR' },
                { id: 2, name: 'Livret A Épargne', initial_balance: 8500.0, current_balance: 8800.0, is_savings: true, is_archived: false, currency: 'EUR' }
            ],
            categories: [
                { id: 1, name: 'Revenus & Salaires', type: 'income', parent_id: null, icon: '💰', color: '#10b981' },
                { id: 2, name: 'Logement & Charges', type: 'expense_fixed', parent_id: null, icon: '🏠', color: '#6366f1' },
                { id: 3, name: 'Alimentation & Courses', type: 'expense_var', parent_id: null, icon: '🛒', color: '#f59e0b' },
                { id: 4, name: 'Loisirs & Sorties', type: 'expense_var', parent_id: null, icon: '🎬', color: '#ec4899' }
            ],
            transactions: [
                { id: 101, date: `${ym}-01`, description: 'Virement Salaire Mensuel', amount: 2850.0, type: 'income', category_id: 1, category_name: 'Revenus & Salaires', from_account_id: null, to_account_id: 1, is_checked: true },
                { id: 102, date: `${ym}-05`, description: 'Loyer & Charges', amount: 890.0, type: 'expense_fixed', category_id: 2, category_name: 'Logement & Charges', from_account_id: 1, to_account_id: null, is_checked: true },
                { id: 103, date: `${ym}-12`, description: 'Supermarché Bio', amount: 142.5, type: 'expense_var', category_id: 3, category_name: 'Alimentation & Courses', from_account_id: 1, to_account_id: null, is_checked: true },
                { id: 104, date: `${ym}-15`, description: 'Épargne Mensuelle Livret A', amount: 300.0, type: 'transfer', category_id: null, category_name: 'Virement interne', from_account_id: 1, to_account_id: 2, is_checked: true },
                { id: 105, date: today, description: 'Restaurant & Cinéma', amount: 82.0, type: 'expense_var', category_id: 4, category_name: 'Loisirs & Sorties', from_account_id: 1, to_account_id: null, is_checked: false }
            ],
            budgets: [
                { id: 1, name: 'Alimentation', amount: 450.0, spent: 142.5, remaining: 307.5, period: 'monthly', category_ids: [3] },
                { id: 2, name: 'Loisirs & Sorties', amount: 250.0, spent: 82.0, remaining: 168.0, period: 'monthly', category_ids: [4] }
            ]
        };
        return this._demoState;
    },

    async handleDemoRequest(urlStr, config = {}) {
        setTimeout(() => this._ensureDemoBanner(), 100);
        const state = this._getDemoState();
        const method = (config && config.method) ? config.method.toUpperCase() : 'GET';
        const path = urlStr.replace(/^https?:\/\/[^/]+/, '').split('?')[0];

        const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
            status,
            headers: { 'Content-Type': 'application/json' }
        });

        if (path === '/api/version' || path === '/api/system/discovery') {
            return jsonResponse({ app: 'OmniBank-Local', name: 'OmniBank Démo', version: '1.2.11', status: 'ok' });
        }
        if (path === '/api/health') {
            return jsonResponse({ status: 'ok' });
        }
        if (path.startsWith('/api/profiles')) {
            return jsonResponse({
                active_profile_id: 'demo',
                profiles: [{ id: 'demo', name: 'Espace Démo', color: '#6366f1', icon: '✨', has_pin: false }]
            });
        }
        if (path.startsWith('/api/config')) {
            return jsonResponse({ base_currency: 'EUR', enable_ai: 'false', enable_org_mode: 'false' });
        }
        if (path.startsWith('/api/setup/status')) {
            return jsonResponse({ needs_setup: false, has_accounts: true });
        }
        if (path.startsWith('/api/accounts')) {
            return jsonResponse(state.accounts);
        }
        if (path.startsWith('/api/categories')) {
            return jsonResponse(state.categories);
        }
        if (path.startsWith('/api/transactions')) {
            if (method === 'POST' && config && config.body) {
                try {
                    const body = JSON.parse(config.body);
                    const newTx = Object.assign({ id: Date.now(), is_checked: true }, body);
                    state.transactions.unshift(newTx);
                    return jsonResponse(newTx, 201);
                } catch (_) {}
            }
            return jsonResponse({ items: state.transactions, total: state.transactions.length, transactions: state.transactions });
        }
        if (path.startsWith('/api/budgets')) {
            return jsonResponse(state.budgets);
        }
        if (path.startsWith('/api/recurrences')) {
            return jsonResponse([]);
        }
        if (path.startsWith('/api/notifications')) {
            return jsonResponse([]);
        }
        if (path.startsWith('/api/history')) {
            return jsonResponse({ can_undo: false, can_redo: false, items: [] });
        }
        if (path.startsWith('/api/license')) {
            return jsonResponse({ active: false });
        }
        if (path.startsWith('/api/stats')) {
            return jsonResponse({
                total_balance: 11985.5,
                checking_balance: 3185.5,
                savings_balance: 8800.0,
                monthly_income: 2850.0,
                monthly_expenses: 1114.5,
                remaining_to_live: 1735.5,
                accounts: state.accounts,
                recent_transactions: state.transactions
            });
        }
        return jsonResponse({});
    },

    openModal(opts = {}) {
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
            const hn = window.location.hostname || '';
            if (hostInput) hostInput.value = (hn === 'localhost' || hn === '127.0.0.1') ? '' : hn;
            if (portInput) portInput.value = window.location.port || '8434';
        }

        modal.style.display = 'flex';
        if (opts && opts.autoScan) {
            this.discoverServers();
        }
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

        // Reconnaissance spéciale du mot-clé "demo" pour les vérificateurs Apple App Store / Google Play
        if (host.toLowerCase() === 'demo' || host.toLowerCase() === 'demo.omnibank.local') {
            this.enableDemoMode();
            return 'demo';
        }

        let cleanHost = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        let protocol = 'http';
        if (host.startsWith('https://') || port === '443') {
            protocol = 'https';
        }

        const testUrl = cleanHost.includes(':') ? `${protocol}://${cleanHost}` : `${protocol}://${cleanHost}:${port}`;

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
            let res = await fetchFn(`${testUrl}/api/system/discovery`, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            }).catch(() => null);

            if (!res || !res.ok) {
                res = await fetchFn(`${testUrl}/api/version`, {
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json' }
                });
            }
            clearTimeout(timeoutId);

            if (res && res.ok) {
                const json = await res.json();
                const ver = json.version || 'Inconnue';
                const srvName = json.name || 'OmniBank';
                if (statusEl) {
                    statusEl.style.background = 'rgba(54, 179, 126, 0.15)';
                    statusEl.style.color = 'var(--success)';
                    statusEl.textContent = `✅ Connexion réussie ! ${srvName} (v${ver}) disponible.`;
                }
                return testUrl;
            } else {
                throw new Error(`HTTP ${res ? res.status : 'Erreur'}`);
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
        if (validatedUrl && validatedUrl !== 'demo') {
            localStorage.removeItem('omnibank_demo_mode');
            API.setBaseUrl(validatedUrl);
            if (typeof showToast === 'function') {
                showToast(`Serveur configuré : ${validatedUrl}`, 'success');
            }
            this.closeModal();
            setTimeout(() => window.location.reload(), 500);
        }
    },

    async getLocalIPSubnets() {
        const subnets = new Set(['192.168.1', '192.168.0']);
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
                resolve(Array.from(subnets));
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
            statusEl.textContent = '🔍 Recherche des serveurs OmniBank sur le Wi-Fi local...';
        }

        if (discContainer) discContainer.style.display = 'block';
        if (discList) discList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">Scan mDNS & sous-réseaux locaux en cours...</div>';

        const found = [];
        const fetchFn = window._originalFetch || window.fetch;

        // Candidats prioritaires : mDNS .local et boucle locale
        const candidates = ['omnibank.local', 'unraid.local', 'localhost', '127.0.0.1'];
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
                for (let i = 1; i <= 254; i++) {
                    const ip = `${clean}.${i}`;
                    if (!candidates.includes(ip)) candidates.push(ip);
                }
            }
        };

        addHostAndSubnet(inputHost);
        addHostAndSubnet(currentHost);

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
                const tid = setTimeout(() => controller.abort(), 1100);
                let res = await fetchFn(`http://${ip}:${port}/api/system/discovery`, { signal: controller.signal }).catch(() => null);
                if (!res || !res.ok) {
                    res = await fetchFn(`http://${ip}:${port}/api/version`, { signal: controller.signal });
                }
                clearTimeout(tid);
                if (res && res.ok) {
                    const json = await res.json();
                    return {
                        ip,
                        port,
                        name: json.name || 'OmniBank Local',
                        version: json.version || '?'
                    };
                }
            } catch (e) {}
            return null;
        };

        const chunkSize = 30;
        for (let i = 0; i < candidates.length; i += chunkSize) {
            const batch = candidates.slice(i, i + chunkSize);
            const results = await Promise.all(batch.map(ip => checkServer(ip)));
            results.forEach(r => {
                if (r && !found.some(existing => existing.ip === r.ip && existing.port === r.port)) {
                    found.push(r);
                }
            });
            if (found.length > 0 && i >= 60) break;
        }

        if (found.length > 0) {
            if (statusEl) {
                statusEl.style.background = 'rgba(54, 179, 126, 0.15)';
                statusEl.style.color = 'var(--success)';
                statusEl.textContent = `🎉 ${found.length} serveur(s) OmniBank détecté(s) !`;
            }
            if (discList) {
                discList.innerHTML = found.map(s => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-base); padding:8px 12px; border-radius:8px; border:1px solid var(--border-color); cursor:pointer;" onclick="window.ServerConfig.selectDiscovered('${s.ip}', ${s.port})">
                        <div>
                            <div style="font-weight:700; font-size:13px; color:var(--text-main);">🟢 ${s.name} (${s.ip}:${s.port})</div>
                            <div style="font-size:11px; color:var(--text-muted);">OmniBank v${s.version}</div>
                        </div>
                        <button class="btn btn-primary" style="font-size:11px; padding:4px 10px;">Connexion 1-Clic</button>
                    </div>
                `).join('');
            }
        } else {
            if (statusEl) {
                statusEl.style.background = 'rgba(245, 158, 11, 0.15)';
                statusEl.style.color = '#f59e0b';
                statusEl.textContent = 'Aucun serveur détecté sur le Wi-Fi. Saisissez l\'IP manuellement ou lancez le Mode Démo.';
            }
            if (discList) {
                discList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">Aucune instance détectée automatiquement.</div>';
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
