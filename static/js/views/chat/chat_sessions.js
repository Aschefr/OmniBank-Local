// static/js/views/chat/chat_sessions.js — Gestion des conversations, barre latérale & faits mémoire
window.ChatView = Object.assign(window.ChatView || {}, {
    toggleSidebar() {
        const sidebar = document.getElementById('chatSidebar');
        const backdrop = document.getElementById('chatSidebarBackdrop');
        if (sidebar && backdrop) {
            sidebar.classList.toggle('open');
            backdrop.classList.toggle('open');
        }
    },

    toggleInfoPanel() {
        const panel = document.getElementById('chatInfoPanel');
        if (panel) panel.classList.toggle('open');
    },

    toggleMemoryModal() {
        const panel = document.getElementById('chatMemoryPanel');
        if (panel) {
            const isOpen = panel.classList.toggle('open');
            if (isOpen) {
                // Ensure correct default checkbox state and visibility
                const activeSession = this.activeSessionId;
                const privateContainer = document.getElementById('new_fact_private_container');
                const privateCheckbox = document.getElementById('new_fact_private');
                if (privateContainer && privateCheckbox) {
                    if (activeSession) {
                        privateContainer.style.display = 'flex';
                        privateCheckbox.checked = true; // default private to session if session open
                    } else {
                        privateContainer.style.display = 'none';
                        privateCheckbox.checked = false;
                    }
                }
                this.fetchFacts();
            }
        }
    },

    async fetchFacts() {
        const container = document.getElementById('aiMemoryListContainer');
        if (!container) return;
        
        try {
            const activeUser = sessionStorage.getItem('omni_current_user') || '';
            let url = '/api/chat/facts';
            if (activeUser) {
                url += `?user_name=${encodeURIComponent(activeUser)}`;
            }
            
            const facts = await API.get(url);
            if (!facts || facts.length === 0) {
                container.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 15px;" data-i18n="config_ai_memory_no_facts">
                            ${window.i18n.t('config_ai_memory_no_facts')}
                        </td>
                    </tr>
                `;
                return;
            }
            
            container.innerHTML = facts.map(f => {
                const scopeLabel = f.session_id 
                    ? `<span class="badge" style="background: rgba(51, 102, 255, 0.1); color: var(--accent); font-size: 10px; padding: 2px 6px; border-radius: 4px;">${window.i18n.t('config_ai_memory_scope_session')} (ID: ${f.session_id})</span>`
                    : `<span class="badge" style="background: rgba(0, 200, 83, 0.1); color: var(--color-income); font-size: 10px; padding: 2px 6px; border-radius: 4px;">${window.i18n.t('config_ai_memory_scope_global')}</span>`;
                
                // Desktop: table row — Mobile: card via CSS classes
                return `
                    <tr id="fact-row-${f.id}" class="ai-memory-row">
                        <td class="ai-memory-cell-key" data-label="${window.i18n.t('config_ai_memory_col_key')}">${f.fact_key}</td>
                        <td class="ai-memory-cell-val" data-label="${window.i18n.t('config_ai_memory_col_value')}">
                            <input type="text" id="fact-input-${f.id}" class="inline-input ai-memory-input" value="${f.fact_value.replace(/"/g, '&quot;')}" onchange="window.ChatView.saveFactInline(${f.id})">
                        </td>
                        <td class="ai-memory-cell-scope" data-label="${window.i18n.t('config_ai_memory_col_scope')}">${scopeLabel}</td>
                        <td class="ai-memory-cell-action">
                            <button class="btn btn-secondary ai-memory-del-btn" onclick="window.ChatView.deleteFact(${f.id})">
                                🗑️ ${window.i18n.t('config_ai_memory_btn_delete')}
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            console.error("Failed to fetch AI facts", e);
        }
    },

    async saveFactInline(id) {
        const input = document.getElementById(`fact-input-${id}`);
        if (!input) return;
        
        try {
            const activeUser = sessionStorage.getItem('omni_current_user') || '';
            let url = '/api/chat/facts';
            if (activeUser) url += `?user_name=${encodeURIComponent(activeUser)}`;
            const facts = await API.get(url);
            const fact = facts.find(f => f.id === id);
            if (!fact) return;
            
            await API.post('/api/chat/facts', {
                fact_key: fact.fact_key,
                fact_value: input.value,
                session_id: fact.session_id,
                private_to_session: !!fact.session_id,
                user_name: activeUser
            });
            showToast("Mémoire mise à jour !", "success", 2000);
            this.fetchFacts();
        } catch (e) {
            console.error("Failed to save fact inline", e);
            showToast("Erreur de sauvegarde", "error", 2000);
        }
    },

    async deleteFact(id) {
        if (!confirm("Voulez-vous vraiment oublier cette information ?")) return;
        try {
            await API.del(`/api/chat/facts/${id}`);
            showToast("Information oubliée !", "success", 2000);
            this.fetchFacts();
        } catch (e) {
            console.error("Failed to delete fact", e);
            showToast("Erreur de suppression", "error", 2000);
        }
    },

    async addFactManual() {
        const keyInput = document.getElementById('new_fact_key');
        const valInput = document.getElementById('new_fact_value');
        const privateCheckbox = document.getElementById('new_fact_private');
        if (!keyInput || !valInput) return;
        
        const key = keyInput.value.trim();
        const val = valInput.value.trim();
        if (!key || !val) {
            showToast("Veuillez remplir la clé et la valeur.", "error", 2000);
            return;
        }
        
        try {
            const activeUser = sessionStorage.getItem('omni_current_user') || '';
            const privateToSession = privateCheckbox ? privateCheckbox.checked : false;
            
            await API.post('/api/chat/facts', {
                fact_key: key,
                fact_value: val,
                session_id: privateToSession ? this.activeSessionId : null,
                private_to_session: privateToSession,
                user_name: activeUser
            });
            keyInput.value = '';
            valInput.value = '';
            showToast("Fait ajouté !", "success", 2000);
            this.fetchFacts();
        } catch (e) {
            console.error("Failed to add fact manually", e);
            showToast("Erreur d'ajout", "error", 2000);
        }
    },

    populateInfoToolsList() {
        const container = document.getElementById('chatInfoToolsList');
        if (!container) return;

        const groups = [
            {
                emoji: '📊',
                name: window.i18n.t('chat_group_analysis_name') || 'Analyse & Soldes',
                access: 'readonly',
                desc: window.i18n.t('chat_group_analysis_desc') || 'Consultation en temps réel du reste à vivre, du patrimoine net global, des soldes de comptes bancaires et de l\'état d\'avancement des enveloppes budgétaires.',
                tools: 'get_financial_summary, get_spending_trends, get_dashboard_synthesis, get_monthly_overview, get_net_worth, get_account_balances, get_spending_analytics, get_budgets_status, get_recurrence_templates, get_net_worth_history'
            },
            {
                emoji: '🔍',
                name: window.i18n.t('chat_group_search_name') || 'Recherche & Classification',
                access: 'readonly',
                desc: window.i18n.t('chat_group_search_desc') || 'Recherche d\'opérations multicritères, suggestion intelligente de catégories, détection d\'anomalies ou abonnements et génération d\'exports CSV.',
                tools: 'search_transactions, search_similar_past_spends, suggest_transaction_category, detect_anomalies_and_subscriptions, generate_csv_export_link'
            },
            {
                emoji: '📈',
                name: window.i18n.t('chat_group_simulation_name') || 'Simulations & Conseils',
                access: 'readonly',
                desc: window.i18n.t('chat_group_simulation_desc') || 'Projections de solde à 30/60/90 jours, simulation d\'impact d\'un achat sur un budget, calcul d\'amortissement de prêt et préconisations d\'épargne.',
                tools: 'forecast_balances_history, get_envelopes_impact, simulate_loan_amortization, get_saving_recommendations'
            },
            {
                emoji: '⚡',
                name: window.i18n.t('chat_group_write_name') || 'Actions & Modifications',
                access: 'validation',
                desc: window.i18n.t('chat_group_write_desc') || 'Création, modification et suppression directe d\'enveloppes de budget, de modèles de récurrence, de tirelires (alimentation/retrait) et de catégories. (Toutes ces actions sont soumises à la revue et annulables à 100% via l\'historique).',
                tools: 'apply_transaction_correction, delete_transaction, create_budget_envelope, update_budget_envelope, delete_budget_envelope, allocate_savings_funds, create_recurrence_template, update_recurrence_template, delete_recurrence_template, create_category, delete_category, set_predicted_paycheck'
            },
            {
                emoji: '🧠',
                name: window.i18n.t('chat_group_memory_name') || 'Mémoire',
                access: 'memory',
                desc: window.i18n.t('chat_group_memory_desc') || 'Mémorisation et oubli de faits financiers persistants à travers les conversations (loyer, objectifs d\'épargne, événements récurrents…).',
                tools: 'store_financial_fact, forget_financial_fact'
            }
        ];


        const rows = groups.map(g => {
            const i18nKey = g.access === 'validation' ? 'chat_info_access_validation'
                          : g.access === 'memory'     ? 'chat_info_access_memory'
                          :                             'chat_info_access_readonly';
            const accessBadge = `<span class="access-badge badge-${g.access}">
                ${window.i18n.t(i18nKey)}
            </span>`;


            const toolsHtml = g.tools.split(', ').map(t => {
                const toolLabel = (window.i18n && window.i18n.t(`tool_${t}`)) || t;
                const toolDesc = (window.i18n && window.i18n.t(`tool_${t}_desc`)) || toolLabel;
                return `<code title="${toolDesc.replace(/"/g, '&quot;')}" class="chat-info-tool-code">${toolLabel}</code>`;
            }).join(' ');

            // Card layout (works both on desktop and mobile via CSS)
            return `<div class="chat-info-group-card">
                <div class="chat-info-group-header">
                    <span class="chat-info-group-emoji">${g.emoji}</span>
                    <div class="chat-info-group-meta">
                        <strong class="chat-info-group-name">${g.name}</strong>
                        ${accessBadge}
                    </div>
                </div>
                <p class="chat-info-group-desc">${g.desc}</p>
                <div class="chat-info-group-tools">${toolsHtml}</div>
            </div>`;
        }).join('');

        container.innerHTML = `<div class="chat-info-groups-list">${rows}</div>`;
    },

    async loadSessions(preventSelectSession = false) {
        try {
            const resp = await fetch('/api/chat/sessions');
            if (resp.ok) {
                this.sessions = await resp.json();
                this.renderSidebarList();
 
                if (this.sessions.length > 0 && !preventSelectSession) {
                    const sessionExists = this.activeSessionId && this.sessions.some(s => s.id === this.activeSessionId);
                    if (sessionExists) {
                        await this.selectSession(this.activeSessionId, true);
                    } else {
                        await this.selectSession(this.sessions[0].id);
                    }
                } else if (!this._creatingSession && this.sessions.length === 0) {
                    // Create first session if none exists (with guard against loops)
                    await this.createNewSession();
                }
            }
        } catch (e) {
            console.error("Error loading chat sessions:", e);
        }
    },

    renderSidebarList() {
        const list = document.getElementById('chatSidebarList');
        if (!list) return;

        list.innerHTML = this.sessions.map(s => {
            const isActive = s.id === this.activeSessionId;
            const roleEmoji = s.role === 'simulator' ? '📐' : (s.role === 'alerts' ? '⚠️' : '💬');
            const isDeleting = this.deletingSessionId === s.id;
            
            const actionsHtml = isDeleting ? `
                <button class="chat-session-btn" onclick="window.ChatView.confirmDeleteSession(${s.id})" title="${window.i18n.t('chat_confirm_delete') || 'Confirmer'}" style="color: #ef4444; font-weight: bold;">✔️</button>
                <button class="chat-session-btn" onclick="window.ChatView.cancelDeleteSession()" title="${window.i18n.t('chat_cancel') || 'Annuler'}">❌</button>
            ` : `
                <button class="chat-session-btn" onclick="window.ChatView.startRenameSession(${s.id})" title="${window.i18n.t('chat_edit_msg') || 'Renommer'}">✏️</button>
                <button class="chat-session-btn" onclick="window.ChatView.deleteSession(${s.id})" title="${window.i18n.t('chat_delete_msg') || 'Supprimer'}">🗑️</button>
            `;

            return `
                <div class="chat-session-item ${isActive ? 'active' : ''} ${isDeleting ? 'deleting' : ''}" onclick="window.ChatView.selectSession(${s.id})" title="${window.escapeHtml(s.title)}">
                    <span style="font-size:14px;">${roleEmoji}</span>
                    <span class="chat-session-title" id="session-title-container-${s.id}">
                        <span class="chat-session-title-inner" id="session-title-text-${s.id}">${window.escapeHtml(s.title)}</span>
                    </span>
                    <div class="chat-session-actions" onclick="event.stopPropagation();">
                        ${actionsHtml}
                    </div>
                </div>
            `;
        }).join('');

        // Detect text overflow for scrolling marquee
        setTimeout(() => {
            this.sessions.forEach(s => {
                const container = document.getElementById(`session-title-container-${s.id}`);
                const innerText = document.getElementById(`session-title-text-${s.id}`);
                if (container && innerText) {
                    if (innerText.offsetWidth > container.offsetWidth) {
                        innerText.classList.add('overflowing');
                    }
                }
            });
        }, 50);
    },

    async selectSession(sessionId, isRestore = false) {
        // If there's an active stream on the previous session, detach it so it can complete in background
        if (this._activeAbortController && this.activeSessionId && this.activeSessionId !== sessionId) {
            const oldSessionId = this.activeSessionId;
            this._streamDetached = true;
            fetch(`/api/chat/sessions/${oldSessionId}/notify-on-complete`, { method: 'POST' }).catch(() => {});
            this._activeAbortController = null;
        }

        this.activeSessionId = sessionId;
        sessionStorage.setItem('chatActiveSessionId', sessionId);
        this.editingContext = false;
        this.editingMsgId = null;
        this.confirmDeleteMsgId = null;
        
        // Close drawer if on mobile
        const sidebar = document.getElementById('chatSidebar');
        const backdrop = document.getElementById('chatSidebarBackdrop');
        if (sidebar?.classList.contains('open')) {
            sidebar.classList.remove('open');
            backdrop?.classList.remove('open');
        }

        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            const titleHeader = document.getElementById('chatSessionActiveTitle');
            if (titleHeader) titleHeader.textContent = session.title;

            const roleSelect = document.getElementById('chatRoleSelect');
            if (roleSelect) roleSelect.value = session.role;
        }

        // Refresh facts modal if open
        const panel = document.getElementById('chatMemoryPanel');
        if (panel && panel.classList.contains('open')) {
            const privateContainer = document.getElementById('new_fact_private_container');
            const privateCheckbox = document.getElementById('new_fact_private');
            if (privateContainer && privateCheckbox) {
                if (sessionId) {
                    privateContainer.style.display = 'flex';
                    privateCheckbox.checked = true;
                } else {
                    privateContainer.style.display = 'none';
                    privateCheckbox.checked = false;
                }
            }
            this.fetchFacts();
        }

        this.userHasScrolledUp = false;
        this.renderSidebarList();
        await this.loadMessages(isRestore);
        this.scrollToBottom();
    },

    async createNewSession() {
        const roleSelect = document.getElementById('chatRoleSelect');
        const selectedRole = roleSelect ? roleSelect.value : 'advisor';
        
        try {
            const resp = await fetch('/api/chat/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: selectedRole })
            });
            if (resp.ok) {
                const newSession = await resp.json();
                this.activeSessionId = newSession.id;
                this._creatingSession = true;
                await this.loadSessions();
                await this.selectSession(newSession.id);
                this._creatingSession = false;
            }
        } catch (e) {
            console.error("Error creating session:", e);
            this._creatingSession = false;
        }
    },

    async startRenameSession(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return;

        const titleTextNode = document.getElementById(`session-title-text-${sessionId}`);
        if (!titleTextNode) return;

        const originalTitle = session.title;
        titleTextNode.innerHTML = `
            <input type="text" id="rename-input-${sessionId}" class="inline-input" value="${window.escapeHtml(originalTitle)}" 
                style="width: 100px; padding: 2px 4px; font-size:12px; margin: 0;"
                onkeydown="if(event.key === 'Enter') { window.ChatView.saveSessionRename(${sessionId}, this.value); } else if(event.key === 'Escape') { window.ChatView.renderSidebarList(); }"/>
        `;
        const input = document.getElementById(`rename-input-${sessionId}`);
        input?.focus();
        input?.select();
    },

    async saveSessionRename(sessionId, newTitle) {
        const title = newTitle.trim();
        if (!title) {
            this.renderSidebarList();
            return;
        }

        try {
            const resp = await fetch(`/api/chat/sessions/${sessionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title })
            });
            if (resp.ok) {
                const session = this.sessions.find(s => s.id === sessionId);
                if (session) session.title = title;
                
                if (sessionId === this.activeSessionId) {
                    const titleHeader = document.getElementById('chatSessionActiveTitle');
                    if (titleHeader) titleHeader.textContent = title;
                }
                this.renderSidebarList();
            }
        } catch (e) {
            console.error("Error renaming session:", e);
            this.renderSidebarList();
        }
    },

    async changeSessionRole(newRole) {
        if (!this.activeSessionId) return;
        try {
            const resp = await fetch(`/api/chat/sessions/${this.activeSessionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });
            if (resp.ok) {
                const session = this.sessions.find(s => s.id === this.activeSessionId);
                if (session) session.role = newRole;
                this.renderSidebarList();
            }
        } catch (e) {
            console.error("Error changing session role:", e);
        }
    },

    async deleteSession(sessionId) {
        this.deletingSessionId = sessionId;
        this.renderSidebarList();
    },

    async confirmDeleteSession(sessionId) {
        try {
            const resp = await fetch(`/api/chat/sessions/${sessionId}`, {
                method: 'DELETE'
            });
            if (resp.ok) {
                if (this.activeSessionId === sessionId) {
                    this.activeSessionId = null;
                }
                this.deletingSessionId = null;
                await this.loadSessions();
            }
        } catch (e) {
            console.error("Error deleting session:", e);
        }
    },

    cancelDeleteSession() {
        this.deletingSessionId = null;
        this.renderSidebarList();
    },

    async loadMessages(isRestore = false) {
        if (!this.activeSessionId) return;
        try {
            const resp = await fetch(`/api/chat/sessions/${this.activeSessionId}/messages`);
            if (resp.ok) {
                const data = await resp.json();
                this.messages = data.messages;
                this.compressedContext = data.compressed_context;
                this.lastCompressedMessageId = data.last_compressed_message_id;
                this.bubbleAfterMsgId = data.bubble_after_id || null;
                this.compressionStack = data.compression_stack || null;
                this.isCompressing = data.compressing || false;
                if (data.token_usage) {
                    this.tokenUsage = data.token_usage;
                }
                if (!this._entityCache && this.loadEntityCache) {
                    await this.loadEntityCache();
                }
                this.renderHistory(isRestore);

                // Check compression status if compressing
                this._checkCompressionStatus();

                // Check if the server is still generating a response for this session
                const lastMsg = this.messages[this.messages.length - 1];
                if (lastMsg && lastMsg.role === 'user') {
                    await this._checkAndPollGeneration();
                }
            }
        } catch (e) {
            console.error("Error loading messages:", e);
        }
    },

    async _checkAndPollGeneration() {
        if (!this.activeSessionId) return;
        try {
            const statusResp = await API.get(`/api/chat/sessions/${this.activeSessionId}/generating`);
            if (statusResp && statusResp.generating) {
                // Show typing indicator as a placeholder AI message
                this.messages.push({
                    role: 'assistant',
                    content: '<div class="typing-indicator"><span></span><span></span><span></span></div>'
                });
                this.renderHistory();

                // Start polling until generation completes
                this._generationPollTimer = setInterval(async () => {
                    try {
                        const check = await API.get(`/api/chat/sessions/${this.activeSessionId}/generating`);
                        if (!check || !check.generating) {
                            clearInterval(this._generationPollTimer);
                            this._generationPollTimer = null;
                            await this.loadMessages();
                        }
                    } catch (e) {
                        clearInterval(this._generationPollTimer);
                        this._generationPollTimer = null;
                    }
                }, 2000);
            }
        } catch (e) {
            console.error("Error checking generation status:", e);
        }
    },

    async saveContextEdit() {
        const textarea = document.getElementById('editContextTextarea');
        if (!textarea) return;
        
        const newContext = textarea.value.trim();
        try {
            const resp = await fetch(`/api/chat/sessions/${this.activeSessionId}/context`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ compressed_context: newContext })
            });
            if (resp.ok) {
                this.compressedContext = newContext;
                this.editingContext = false;
                this.renderHistory();
            }
        } catch (e) {
            console.error("Error updating context:", e);
        }
    },

    // Tool emoji map — shared by badges and info panel
    _toolEmojiMap: {
        'get_financial_summary': '💰',
        'get_net_worth': '🏦',
        'get_account_balances': '💳',
        'search_transactions': '🔍',
        'get_spending_analytics': '📊',
        'get_budgets_status': '💸',
        'get_recurrence_templates': '🔄',
        'get_net_worth_history': '📉',
        'get_envelopes_impact': '🔮',
        'suggest_transaction_category': '🏷️',
        'forecast_balances_history': '📅',
        'get_monthly_overview': '📋',
        'detect_anomalies_and_subscriptions': '🔎',
        'apply_transaction_correction': '✏️',
        'get_saving_recommendations': '💡',
        'search_similar_past_spends': '📆',
        'generate_csv_export_link': '📥',
        'simulate_loan_amortization': '🏠',
        'get_recent_transactions': '📝',
        'create_budget_envelope': '📁',
        'update_budget_envelope': '✏️',
        'delete_budget_envelope': '🗑️',
        'allocate_savings_funds': '🐷',
        'create_recurrence_template': '🔁',
        'update_recurrence_template': '✏️',
        'delete_recurrence_template': '🗑️',
        'create_category': '🏷️',
        'delete_category': '🗑️',
        'set_predicted_paycheck': '💵',
        'delete_transaction': '🗑️',
        'store_financial_fact': '🧠',
        'forget_financial_fact': '🧹'
    },


});
