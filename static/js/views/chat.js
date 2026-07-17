const escapeHtml = (text) => {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};
window.escapeHtml = escapeHtml;


window.ChatView = {
    sessions: [],
    activeSessionId: null,
    messages: [],
    compressedContext: null,
    editingContext: false,
    editingMsgId: null,
    pendingActions: {},
    tokenUsage: { used: 0, limit: 32768 },
    _creatingSession: false,

    render() {
        return `
            <style>
                .chat-wrapper {
                    display: flex;
                    height: calc(100vh - 160px);
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    box-shadow: var(--shadow-sm);
                    overflow: hidden;
                    position: relative;
                }
                .chat-sidebar {
                    width: 250px;
                    background: var(--bg-sidebar);
                    border-right: 1px solid var(--border-color);
                    display: flex;
                    flex-direction: column;
                    z-index: 10;
                    transition: transform 0.3s ease;
                }
                .chat-sidebar-header {
                    padding: 12px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .chat-sidebar-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .chat-session-item {
                    padding: 10px;
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    color: var(--text-color);
                    transition: background 0.2s ease;
                }
                .chat-session-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }
                .chat-session-item.active {
                    background: rgba(51, 102, 255, 0.15);
                    border: 1px solid rgba(51, 102, 255, 0.3);
                }
                .chat-session-title {
                    flex: 1;
                    overflow: hidden;
                    white-space: nowrap;
                    position: relative;
                }
                .chat-session-title-inner {
                    display: inline-block;
                    transition: transform 0.3s ease;
                }
                .chat-session-item:hover .chat-session-title-inner.overflowing {
                    animation: title-scroll 6s linear infinite alternate;
                    padding-right: 20px;
                }
                @keyframes title-scroll {
                    0% { transform: translateX(0); }
                    10% { transform: translateX(0); }
                    90% { transform: translate3d(calc(-100% + 150px), 0, 0); }
                    100% { transform: translate3d(calc(-100% + 150px), 0, 0); }
                }
                .chat-session-actions {
                    display: flex;
                    gap: 4px;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                }
                .chat-session-item:hover .chat-session-actions,
                .chat-session-item.active .chat-session-actions {
                    opacity: 1;
                }
                .chat-sidebar-loading {
                    text-align: center;
                    padding: 20px;
                    color: var(--text-muted);
                    font-size: 12px;
                    font-style: italic;
                }
                .chat-session-btn {
                    background: none;
                    border: none;
                    color: var(--text-muted);
                    cursor: pointer;
                    padding: 2px;
                    font-size: 12px;
                    border-radius: 4px;
                }
                .chat-session-btn:hover {
                    color: var(--text-color);
                    background: rgba(255, 255, 255, 0.1);
                }
                .chat-main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    position: relative;
                }
                .chat-main-header {
                    padding: 12px 20px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: var(--bg-sidebar);
                }
                .chat-messages {
                    flex: 1;
                    padding: 20px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                .chat-message-row {
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    max-width: 80%;
                    margin-bottom: 8px;
                }
                .chat-message-row.user {
                    align-self: flex-end;
                    align-items: flex-end;
                }
                .chat-message-row.assistant {
                    align-self: flex-start;
                    align-items: flex-start;
                }
                .chat-message-meta {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-bottom: 4px;
                    padding: 0 4px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 10px;
                    width: 100%;
                }
                .chat-bubble {
                    padding: 12px 16px;
                    border-radius: 12px;
                    font-size: 14px;
                    line-height: 1.5;
                    position: relative;
                    transition: box-shadow 0.2s ease;
                    width: fit-content;
                    max-width: 100%;
                }
                .chat-bubble.user {
                    background: var(--accent);
                    color: #fff;
                    border-bottom-right-radius: 4px;
                }
                .chat-bubble.ai {
                    background: var(--bg-sidebar);
                    color: var(--text-color);
                    border: 1px solid var(--border-color);
                    border-bottom-left-radius: 4px;
                }
                .chat-bubble.ai ul, .chat-bubble.ai ol {
                    padding-left: 24px;
                    margin: 8px 0;
                }
                .chat-message-actions {
                    display: flex;
                    gap: 8px;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    margin-top: 4px;
                    width: fit-content;
                }
                .chat-message-row.user .chat-message-actions {
                    justify-content: flex-end;
                }
                .chat-message-row.assistant .chat-message-actions {
                    justify-content: flex-start;
                }
                .chat-message-row:hover .chat-message-actions,
                .chat-message-row:last-child .chat-message-actions {
                    opacity: 1;
                }
                .chat-message-action-btn {
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    color: var(--text-muted);
                    font-size: 10px;
                    cursor: pointer;
                    border-radius: 4px;
                    padding: 2px 6px;
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    box-shadow: var(--shadow-sm);
                }
                .chat-message-action-btn:hover {
                    color: var(--text-color);
                    border-color: var(--text-muted);
                }
                .context-block {
                    margin-bottom: 10px;
                    border: 1px solid rgba(245, 158, 11, 0.3);
                    background: rgba(245, 158, 11, 0.05);
                    border-radius: 8px;
                    padding: 10px;
                }
                .context-details {
                    font-size: 13px;
                }
                .context-summary {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: pointer;
                    font-weight: 600;
                }
                .context-summary::-webkit-details-marker {
                    color: #f59e0b;
                }
                .edit-textarea {
                    width: 100%;
                    min-height: 80px;
                    background: transparent;
                    color: inherit;
                    border: 1px solid rgba(255, 255, 255, 0.25);
                    border-radius: 6px;
                    padding: 8px;
                    font-size: 14px;
                    font-family: var(--font-family, inherit);
                    line-height: 1.5;
                    resize: vertical;
                    margin: 0;
                    box-sizing: border-box;
                    outline: none;
                }
                .chat-bubble.user .edit-textarea {
                    color: #fff;
                    border-color: rgba(255, 255, 255, 0.4);
                }
                .chat-bubble.user .edit-textarea:focus {
                    border-color: #fff;
                    background: rgba(0, 0, 0, 0.1);
                }
                .chat-bubble.ai .edit-textarea {
                    color: var(--text-color);
                    border-color: var(--border-color);
                }
                .chat-bubble.ai .edit-textarea:focus {
                    border-color: var(--accent);
                    background: var(--bg-surface);
                }
                .chat-bubble-edit-container {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    width: 100%;
                    min-width: 100%;
                }
                .chat-sidebar-backdrop {
                    display: none;
                    position: absolute;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.4);
                    z-index: 9;
                    backdrop-filter: blur(2px);
                }
                @media (max-width: 768px) {
                    .chat-sidebar {
                        position: absolute;
                        left: 0;
                        top: 0;
                        bottom: 0;
                        transform: translateX(-100%);
                    }
                    .chat-sidebar.open {
                        transform: translateX(0);
                    }
                    .chat-sidebar-backdrop.open {
                        display: block;
                    }
                    .chat-message-row {
                        max-width: 90%;
                    }
                    .chat-message-actions {
                        opacity: 1 !important; /* Always visible on mobile for accessibility */
                    }
                }
                .ai-think-details {
                    border: 1px solid var(--border-color);
                    background: rgba(255, 255, 255, 0.02);
                    border-radius: 8px;
                    margin-bottom: 12px;
                    padding: 6px 10px;
                    width: 100%;
                }
                .ai-think-summary {
                    font-size: 12px;
                    font-weight: 500;
                    color: var(--text-muted);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    user-select: none;
                    outline: none;
                }
                .ai-think-content {
                    font-size: 12.5px;
                    color: var(--text-muted);
                    font-style: italic;
                    margin-top: 8px;
                    padding-left: 8px;
                    border-left: 2px solid var(--border-color);
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                .tool-badge {
                    display: inline-block;
                    font-size: 10px;
                    padding: 2px 6px;
                    background: rgba(51, 102, 255, 0.15);
                    border: 1px solid rgba(51, 102, 255, 0.3);
                    border-radius: 4px;
                    color: var(--accent);
                    font-family: monospace;
                    font-weight: 500;
                    cursor: help;
                    transition: background 0.2s ease;
                }
                .tool-badge:hover {
                    background: rgba(51, 102, 255, 0.25);
                }
                .chat-info-panel {
                    display: none;
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.6);
                    z-index: 1000;
                    align-items: center;
                    justify-content: center;
                    backdrop-filter: blur(4px);
                    animation: fadeIn 0.2s ease;
                }
                .chat-info-panel.open {
                    display: flex;
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .chat-info-modal {
                    background: var(--bg-sidebar);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    width: 95%;
                    max-width: 1000px;
                    max-height: 85vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                    animation: scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
                    overflow: hidden;
                }
                .access-badge {
                    font-size: 11px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-weight: 500;
                }
                .access-badge.badge-readonly {
                    background: rgba(46, 213, 115, 0.15);
                    color: #2ed573;
                    border: 1px solid rgba(46, 213, 115, 0.3);
                }
                .access-badge.badge-validation {
                    background: rgba(255, 165, 0, 0.15);
                    color: #ffa500;
                    border: 1px solid rgba(255, 165, 0, 0.3);
                }
                .role-mini-badge {
                    display: inline-block;
                    font-size: 11px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    padding: 1px 5px;
                    border-radius: 3px;
                    margin-right: 4px;
                    margin-bottom: 2px;
                    color: var(--text-muted);
                }
                @keyframes scaleIn {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .chat-info-modal-header {
                    padding: 16px 24px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .chat-info-modal-header h3 {
                    margin: 0;
                    font-size: 16px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .chat-info-modal-body {
                    padding: 24px;
                    overflow-y: auto;
                    flex: 1;
                }
                .chat-info-section {
                    margin-bottom: 20px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid var(--border-color);
                }
                .chat-info-section:last-child {
                    border-bottom: none;
                }
                .chat-info-section h4 {
                    font-size: 14px;
                    font-weight: 600;
                    margin: 0 0 8px 0;
                    color: var(--accent);
                }
                .chat-info-section p {
                    font-size: 13px;
                    line-height: 1.6;
                    color: var(--text-muted);
                    margin: 0 0 8px 0;
                }
                .chat-info-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 10px;
                }
                .chat-info-table th {
                    border-bottom: 1px solid var(--border-color);
                    padding: 10px 12px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--accent);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .chat-info-table td {
                    padding: 10px 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
                    vertical-align: middle;
                }
                .chat-info-table tr:last-child td {
                    border-bottom: none;
                }
                .chat-info-table td.tool-emoji-col {
                    width: 40px;
                    text-align: center;
                    font-size: 16px;
                    padding-left: 0;
                }
                .chat-info-table td.tool-name-col {
                    width: 200px;
                    white-space: nowrap;
                }
                .chat-info-table td.tool-name-col code {
                    font-size: 11px;
                    background: rgba(255,255,255,0.06);
                    padding: 3px 6px;
                    border-radius: 4px;
                    font-family: monospace;
                    border: 1px solid rgba(255,255,255,0.03);
                }
                .chat-info-table td.tool-access-col {
                    width: 150px;
                    white-space: nowrap;
                }
                .chat-info-table td.tool-params-col {
                    width: 180px;
                    font-size: 12.5px;
                    color: var(--text-main);
                    white-space: nowrap;
                }
                .chat-info-table td.tool-desc-col {
                    font-size: 13px;
                    color: var(--text-muted);
                    white-space: nowrap;
                }
            </style>

            <div class="chat-wrapper">
                <!-- Sidebar Backdrop for Mobile -->
                <div id="chatSidebarBackdrop" class="chat-sidebar-backdrop" onclick="window.ChatView.toggleSidebar()"></div>

                <!-- Left Sidebar: Sessions -->
                <div id="chatSidebar" class="chat-sidebar">
                    <div class="chat-sidebar-header">
                        <h4 style="margin:0; font-weight:600;" data-i18n="chat_sessions_title">${window.i18n.t('chat_sessions_title')}</h4>
                        <button class="btn btn-primary btn-sm" onclick="window.ChatView.createNewSession()" style="padding: 4px 8px; font-size:12px;">
                            ➕
                        </button>
                    </div>
                    <div id="chatSidebarList" class="chat-sidebar-list">
                        <div class="chat-sidebar-loading">⏳ ${window.i18n.t('loading') || 'Chargement...'}</div>
                    </div>
                </div>

                <!-- Right Chat Container -->
                <div class="chat-main">
                    <div class="chat-main-header">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <button id="chatMenuBtn" class="btn btn-secondary btn-sm" onclick="window.ChatView.toggleSidebar()" style="display:none; padding:4px 8px;">
                                ☰
                            </button>
                            <h3 id="chatSessionActiveTitle" style="margin:0; font-size:16px; font-weight:600;">...</h3>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select id="chatRoleSelect" class="inline-input" onchange="window.ChatView.changeSessionRole(this.value)" style="padding: 6px 12px; border-radius: 6px; font-weight: 500;">
                                <option value="advisor" data-i18n="chat_role_advisor">${window.i18n.t('chat_role_advisor')}</option>
                                <option value="simulator" data-i18n="chat_role_simulator">${window.i18n.t('chat_role_simulator')}</option>
                                <option value="alerts" data-i18n="chat_role_alerts">${window.i18n.t('chat_role_alerts')}</option>
                                <option value="optimizer" data-i18n="chat_role_optimizer">${window.i18n.t('chat_role_optimizer')}</option>
                                <option value="budget_planner" data-i18n="chat_role_budget_planner">${window.i18n.t('chat_role_budget_planner')}</option>
                                <option value="forecaster" data-i18n="chat_role_forecaster">${window.i18n.t('chat_role_forecaster')}</option>
                                <option value="auditor" data-i18n="chat_role_auditor">${window.i18n.t('chat_role_auditor')}</option>
                            </select>
                            <button class="btn btn-secondary" onclick="window.ChatView.askDefaultQuestion()" data-i18n-title="tooltip_auto_report" title="Demander le rapport automatique de ce rôle" data-i18n="chat_btn_report" style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">${window.i18n.t('chat_btn_report')}</button>
                            <button class="btn btn-secondary btn-sm" onclick="window.ChatView.toggleInfoPanel()" title="${window.i18n.t('chat_info_title') || 'Informations'}" style="padding: 6px 10px; font-size: 14px;">ℹ️</button>
                        </div>
                    </div>

                    <div id="chatMessages" class="chat-messages">
                        <!-- Messages dynamically rendered -->
                    </div>

                    <div style="padding: 15px; border-top: 1px solid var(--border-color); background: var(--bg-sidebar); display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; gap: 10px;">
                            <textarea id="chatInput" class="inline-input" data-i18n-placeholder="chat_ph_message" placeholder="Posez une question sur vos finances..." 
                                style="flex: 1; resize: none; border: 1px solid var(--border-color); padding: 12px; border-radius: 8px; min-height: 44px; max-height: 120px;" 
                                onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); window.ChatView.sendMessage(); }"></textarea>
                            
                            <button class="btn btn-primary" id="chatSendBtn" onclick="window.ChatView.sendMessage()" style="padding: 0 20px;" data-i18n="chat_btn_send">
                                ${window.i18n.t('chat_btn_send')}
                            </button>
                        </div>
                        <!-- Token Usage Indicator -->
                        <div id="chatTokenIndicator" style="font-size: 11px; text-align: right; font-weight: 500; transition: color 0.3s ease;">
                            <!-- Set dynamically -->
                        </div>
                    </div>

                    <!-- Info Panel Modal -->
                    <div id="chatInfoPanel" class="chat-info-panel" onclick="if(event.target === this) window.ChatView.toggleInfoPanel()">
                        <div class="chat-info-modal">
                            <div class="chat-info-modal-header">
                                <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">
                                    <span>ℹ️ ${window.i18n.t('chat_info_title')}</span>
                                </h3>
                                <button class="chat-session-btn" onclick="window.ChatView.toggleInfoPanel()" style="font-size: 20px; background: transparent; border: none; cursor: pointer; color: var(--text-muted);">✕</button>
                            </div>

                            <div class="chat-info-modal-body">
                                <div class="chat-info-section">
                                    <h4>🤖 ${window.i18n.t('chat_info_assistant_title')}</h4>
                                    <p>${window.i18n.t('chat_info_assistant_desc')}</p>
                                </div>

                                <div class="chat-info-section">
                                    <h4>🔧 ${window.i18n.t('chat_info_tools_title')}</h4>
                                    <p style="margin-bottom:12px;">${window.i18n.t('chat_info_tools_intro')}</p>
                                    <div id="chatInfoToolsList" style="overflow-x: auto;"></div>
                                </div>

                                <div class="chat-info-section" style="border-bottom: none; margin-bottom: 0; padding-bottom: 0;">
                                    <h4>🛡️ ${window.i18n.t('chat_info_validation_title')}</h4>
                                    <p>${window.i18n.t('chat_info_validation_desc')}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    destroy() {
        // If there's an active stream, user is leaving during generation
        // DON'T abort — let the backend finish generating and save to DB
        if (this._activeAbortController) {
            const sessionId = this.activeSessionId;
            // Mark stream as detached — handleStreamingResponse will skip DOM updates
            this._streamDetached = true;
            // Register for notification when generation completes
            if (sessionId) {
                fetch(`/api/chat/sessions/${sessionId}/notify-on-complete`, { method: 'POST' }).catch(() => {});
            }
            // Don't abort — the fetch will continue in background and finish naturally
            // The AbortController reference stays so the stream can complete
            this._activeAbortController = null;
        }
        // Clear generation polling timer
        if (this._generationPollTimer) {
            clearInterval(this._generationPollTimer);
            this._generationPollTimer = null;
        }
    },

    async init() {
        this.sessions = [];
        const savedSessionId = sessionStorage.getItem('chatActiveSessionId');
        this.activeSessionId = savedSessionId ? parseInt(savedSessionId) : null;
        this.messages = [];
        this.compressedContext = null;
        this.editingContext = false;
        this.editingMsgId = null;
        this.pendingActions = {};
        this.tokenUsage = { used: 0, limit: 32768 };
        this._creatingSession = false;
        this._activeAbortController = null; // Track if a stream is active
        this._streamDetached = false; // True when user left view during generation

        // Fetch actual Ollama config limit
        try {
            const cfgResp = await fetch('/api/config/');
            if (cfgResp.ok) {
                const cfg = await cfgResp.json();
                if (cfg.ollama_num_ctx) {
                    this.tokenUsage.limit = cfg.ollama_num_ctx;
                }
            }
        } catch(e) { /* config fetch failed, keep default */ }

        // Handle responsive header menu button display
        const checkViewport = () => {
            const menuBtn = document.getElementById('chatMenuBtn');
            if (menuBtn) {
                menuBtn.style.display = window.innerWidth <= 768 ? 'inline-block' : 'none';
            }
        };
        setTimeout(checkViewport, 100);
        window.addEventListener('resize', checkViewport);

        // Event delegation for AI action boxes
        document.getElementById('chatMessages')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action-id]');
            if (btn) window.ChatView.openActionModal(parseInt(btn.dataset.actionId));
        });

        await this.loadSessions();
        this.populateInfoToolsList();
    },

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

    populateInfoToolsList() {
        const container = document.getElementById('chatInfoToolsList');
        if (!container) return;
        
        const toolOrder = [
            'get_financial_summary', 'get_net_worth', 'get_account_balances',
            'search_transactions', 'get_spending_analytics', 'get_budgets_status',
            'get_recurrence_templates', 'get_net_worth_history', 'get_envelopes_impact',
            'suggest_transaction_category', 'forecast_balances_history',
            'detect_anomalies_and_subscriptions', 'apply_transaction_correction',
            'get_saving_recommendations', 'search_similar_past_spends',
            'generate_csv_export_link', 'simulate_loan_amortization'
        ];

        const toolMeta = {
            get_financial_summary: { access: 'readonly', params: 'none', roles: ['advisor', 'budget_planner'] },
            get_net_worth: { access: 'readonly', params: 'none', roles: ['advisor', 'simulator'] },
            get_account_balances: { access: 'readonly', params: 'none', roles: ['advisor', 'simulator', 'alerts'] },
            search_transactions: { access: 'readonly', params: 'query', roles: ['advisor', 'auditor'] },
            get_spending_analytics: { access: 'readonly', params: 'date_range', roles: ['advisor', 'optimizer'] },
            get_budgets_status: { access: 'readonly', params: 'month', roles: ['advisor', 'budget_planner', 'optimizer'] },
            get_recurrence_templates: { access: 'readonly', params: 'none', roles: ['advisor', 'alerts', 'budget_planner'] },
            get_net_worth_history: { access: 'readonly', params: 'months_count', roles: ['advisor', 'simulator', 'forecaster'] },
            get_envelopes_impact: { access: 'readonly', params: 'amount_cat', roles: ['advisor', 'budget_planner', 'simulator'] },
            suggest_transaction_category: { access: 'readonly', params: 'desc_amount', roles: ['advisor', 'auditor'] },
            forecast_balances_history: { access: 'readonly', params: 'days', roles: ['advisor', 'forecaster', 'simulator'] },
            detect_anomalies_and_subscriptions: { access: 'readonly', params: 'none', roles: ['advisor', 'alerts', 'auditor'] },
            apply_transaction_correction: { access: 'validation', params: 'correction', roles: ['auditor', 'advisor'] },
            get_saving_recommendations: { access: 'readonly', params: 'none', roles: ['advisor', 'optimizer', 'simulator'] },
            search_similar_past_spends: { access: 'readonly', params: 'desc', roles: ['advisor', 'optimizer'] },
            generate_csv_export_link: { access: 'readonly', params: 'export', roles: ['advisor', 'auditor'] },
            simulate_loan_amortization: { access: 'readonly', params: 'loan', roles: ['simulator'] }
        };
        
        const rows = toolOrder.map(name => {
            const emoji = this._toolEmojiMap[name] || '⚙️';
            const desc = window.i18n.t(`tool_${name}`) || name;
            
            const meta = toolMeta[name] || { access: 'readonly', params: 'none', roles: [] };
            
            // Access badge
            const isVal = meta.access === 'validation';
            const accessBadge = `<span class="access-badge badge-${meta.access}">
                ${window.i18n.t(isVal ? 'chat_info_access_validation' : 'chat_info_access_readonly')}
            </span>`;
            
            // Params label
            const paramsLabel = window.i18n.t(`tool_params_${meta.params}`) || meta.params;

            return `<tr>
                <td class="tool-emoji-col">${emoji}</td>
                <td class="tool-name-col"><code>${name}</code></td>
                <td class="tool-access-col">${accessBadge}</td>
                <td class="tool-params-col">${paramsLabel}</td>
                <td class="tool-desc-col">${desc}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `<table class="chat-info-table">
            <thead>
                <tr>
                    <th style="padding-left: 0; width: 40px;"></th>
                    <th>${window.i18n.t('chat_info_header_tool')}</th>
                    <th>${window.i18n.t('chat_info_header_access')}</th>
                    <th>${window.i18n.t('chat_info_header_params')}</th>
                    <th>${window.i18n.t('chat_info_header_desc')}</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>`;
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
            
            return `
                <div class="chat-session-item ${isActive ? 'active' : ''}" onclick="window.ChatView.selectSession(${s.id})" title="${window.escapeHtml(s.title)}">
                    <span style="font-size:14px;">${roleEmoji}</span>
                    <span class="chat-session-title" id="session-title-container-${s.id}">
                        <span class="chat-session-title-inner" id="session-title-text-${s.id}">${window.escapeHtml(s.title)}</span>
                    </span>
                    <div class="chat-session-actions" onclick="event.stopPropagation();">
                        <button class="chat-session-btn" onclick="window.ChatView.startRenameSession(${s.id})" title="${window.i18n.t('chat_edit_msg') || 'Renommer'}">✏️</button>
                        <button class="chat-session-btn" onclick="window.ChatView.deleteSession(${s.id})" title="${window.i18n.t('chat_delete_msg') || 'Supprimer'}">🗑️</button>
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
        this.activeSessionId = sessionId;
        sessionStorage.setItem('chatActiveSessionId', sessionId);
        this.editingContext = false;
        this.editingMsgId = null;
        
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

        this.renderSidebarList();
        await this.loadMessages(isRestore);
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
        const titleKey = window.i18n.t('title_deletion') || 'Suppression';
        const msgKey = window.i18n.t('chat_delete_confirm') || 'Supprimer cette conversation ?';
        if (await showInlineConfirm(titleKey, msgKey)) {
            try {
                const resp = await fetch(`/api/chat/sessions/${sessionId}`, {
                    method: 'DELETE'
                });
                if (resp.ok) {
                    if (this.activeSessionId === sessionId) {
                        this.activeSessionId = null;
                    }
                    await this.loadSessions();
                }
            } catch (e) {
                console.error("Error deleting session:", e);
            }
        }
    },

    async loadMessages(isRestore = false) {
        if (!this.activeSessionId) return;
        try {
            const resp = await fetch(`/api/chat/sessions/${this.activeSessionId}/messages`);
            if (resp.ok) {
                const data = await resp.json();
                this.messages = data.messages;
                this.compressedContext = data.compressed_context;
                if (data.token_usage) {
                    this.tokenUsage = data.token_usage;
                }
                this.renderHistory(isRestore);

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
        'detect_anomalies_and_subscriptions': '🔎',
        'apply_transaction_correction': '✏️',
        'get_saving_recommendations': '💡',
        'search_similar_past_spends': '📆',
        'generate_csv_export_link': '📥',
        'simulate_loan_amortization': '🏠',
        'get_recent_transactions': '📝'
    },

    formatMessageContent(msg) {
        const isUser = msg.role === 'user';
        let displayContent = msg.content;
        
        if (!isUser && window.marked && window.DOMPurify) {
            let rawContent = msg.content;
            let actions = [];

            // Strip TOOLS_USED comment (badges are rendered in renderHistory meta-row)
            rawContent = rawContent.replace(/<!--\s*TOOLS_USED:\s*[^>]+?\s*-->\n?/, '');
            
            // Match signature {"id": 123, "updates": {...}}
            const actionRegex = /\{\s*"id"\s*:\s*\d+\s*,\s*"updates"\s*:\s*\{[^}]+\}\s*\}/g;
            rawContent = rawContent.replace(actionRegex, (match) => {
                try {
                    const actionObj = JSON.parse(match);
                    actions.push(actionObj);
                    return '';
                } catch (e) {
                    return match;
                }
            });
            
            rawContent = rawContent.replace(/```(?:action|json)?\s*```/g, '');

            // Check for thinking blocks - use placeholders to bypass DOMPurify stripping
            let hasThink = false;
            let isOpenThink = false;
            if (rawContent.includes('<think>')) {
                hasThink = true;
                if (rawContent.includes('</think>')) {
                    rawContent = rawContent.replace(/<think>/g, '___THINK_START___').replace(/<\/think>/g, '___THINK_END___');
                } else {
                    isOpenThink = true;
                    rawContent = rawContent.replace(/<think>/g, '___THINK_START___') + '___THINK_END_ACTIVE___';
                }
            }

            // Check if this content is a standard connection or stream error
            if (rawContent.includes('**Erreur:**') || (rawContent.startsWith('*') && rawContent.endsWith('*') && rawContent.includes('Erreur')) || rawContent.startsWith('⚠️')) {
                let cleanErr = rawContent.replace(/\*\*Erreur:\*\*/g, '').replace(/^\*/, '').replace(/\*$/, '').replace(/⚠️/g, '').trim();
                displayContent = `
                    <div class="ai-error-box" style="padding: 12px 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; color: #ef4444; display: flex; align-items: start; gap: 10px;">
                        <span style="font-size: 18px; line-height: 1;">⚠️</span>
                        <div style="flex: 1;">
                           <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">Échec de la requête</div>
                           <div style="font-size: 12px; opacity: 0.9;">${cleanErr}</div>
                        </div>
                    </div>
                `;
            } else {
                displayContent = DOMPurify.sanitize(marked.parse(rawContent));
                
                // Replace placeholders back to HTML details after sanitization
                if (hasThink) {
                    const thinkTitle = isOpenThink ? "🧠 Réflexion en cours..." : "🧠 Phase de réflexion";
                    const openAttr = isOpenThink ? "open" : "";
                    displayContent = displayContent
                        .replace(/___THINK_START___/g, `<details class="ai-think-details" ${openAttr}><summary class="ai-think-summary"><span>${thinkTitle}</span></summary><div class="ai-think-content">`)
                        .replace(/___THINK_END___/g, '</div></details>')
                        .replace(/___THINK_END_ACTIVE___/g, '</div></details>');
                }

                for (const actionObj of actions) {
                    this.pendingActions[actionObj.id] = actionObj;
                    displayContent += `
                        <div class="ai-action-box" style="margin-top: 15px; padding: 15px; background: rgba(51, 102, 255, 0.08); border: 1px solid var(--accent); border-radius: 8px;">
                            <div style="font-weight: 600; color: var(--accent); margin-bottom: 8px;">${window.i18n.t('chat_ai_recommendation')}</div>
                            <div style="font-size: 12px; margin-bottom: 12px;">${window.i18n.t('chat_ai_propose_modify')} #${actionObj.id}.</div>
                            <button class="btn btn-primary" data-action-id="${actionObj.id}" style="padding: 6px 12px; font-size: 12px;">${window.i18n.t('chat_btn_review')}</button>
                        </div>
                    `;
                }
            }
        } else if (isUser) {
            displayContent = window.escapeHtml(displayContent);
        }

        // Append status indicator if present
        if (!isUser && msg.status) {
            displayContent = `
                <div class="ai-status-indicator" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--accent); padding: 4px 8px; background: rgba(51, 102, 255, 0.1); border-radius: 12px; margin-bottom: 8px;">
                    <span class="spinner-border-sm" style="width:10px; height:10px; border:2px solid; border-right-color:transparent; border-radius:50%; animation: spin 0.75s linear infinite; display: inline-block; box-sizing: border-box;"></span>
                    <span>${msg.status}</span>
                </div>
                <div style="margin-top: 4px;">${displayContent}</div>
            `;
        }
        
        return displayContent;
    },

    renderHistory(isRestore = false) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        let html = '';

        // Render compressed context if present
        if (this.compressedContext !== null && this.compressedContext !== undefined) {
            const tokenEstimate = Math.ceil(this.compressedContext.length / 4);
            html += `
                <div class="context-block">
                    <details class="context-details" ${this.editingContext ? 'open' : ''}>
                        <summary class="context-summary" onclick="if(window.ChatView.editingContext) event.preventDefault();">
                            <span>🗜️ ${window.i18n.t('chat_context_label')}</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:11px; opacity:0.8;">${tokenEstimate} tokens</span>
                                <button class="chat-session-btn" onclick="event.stopPropagation(); window.ChatView.editingContext = true; window.ChatView.renderHistory();" title="Éditer le contexte">✏️</button>
                            </div>
                        </summary>
                        <div style="margin-top:10px;">
                            ${this.editingContext ? `
                                <textarea id="editContextTextarea" class="edit-textarea">${window.escapeHtml(this.compressedContext)}</textarea>
                                <div style="margin-top:8px; display:flex; gap:6px; justify-content:flex-end;">
                                    <button class="btn btn-primary btn-sm" onclick="window.ChatView.saveContextEdit()" style="font-size:12px; padding:2px 8px;">✓</button>
                                    <button class="btn btn-secondary btn-sm" onclick="window.ChatView.editingContext = false; window.ChatView.renderHistory();" style="font-size:12px; padding:2px 8px;">✕</button>
                                </div>
                            ` : `
                                <div style="font-size:12px; line-height:1.4; white-space:pre-wrap; color:var(--text-muted); font-style:italic;">
                                    ${this.compressedContext ? window.escapeHtml(this.compressedContext) : `<em>${window.i18n.t('chat_context_empty')}</em>`}
                                </div>
                            `}
                        </div>
                    </details>
                </div>
            `;
        }

        // Render conversation timeline
        html += this.messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const formattedTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(window.i18n.lang || 'fr', { hour: '2-digit', minute: '2-digit' }) : '';
            const isLastMsg = index === this.messages.length - 1;

            // Extract tool badges for assistant messages
            let toolsBadges = '';
            if (!isUser && msg.content) {
                const match = msg.content.match(/<!--\s*TOOLS_USED:\s*([^>]+?)\s*-->/);
                if (match && match[1]) {
                    const tools = match[1].split(',').map(t => t.trim()).filter(Boolean);
                    toolsBadges = tools.map(t => {
                        const emoji = this._toolEmojiMap[t] || '⚙️';
                        const desc = window.i18n.t(`tool_${t}`) || t;
                        return `<span class="tool-badge" title="${desc}">${emoji} ${t}</span>`;
                    }).join(' ');
                }
            }

            return `
                <div class="chat-message-row ${msg.role}" id="msg-row-${msg.id || index}">
                    <div class="chat-message-meta" style="display:flex; justify-content:space-between; width:100%; align-items:center; gap:10px;">
                        <div>
                            <span>${isUser ? window.i18n.t('chat_label_you') : 'Ollama OmniBank'}</span>
                            ${toolsBadges ? `<span style="margin-left: 8px; display:inline-flex; gap:4px; flex-wrap:wrap;">${toolsBadges}</span>` : ''}
                        </div>
                        <span style="font-size:9px; opacity:0.7;">${formattedTime}</span>
                    </div>
                    <div class="chat-bubble ${isUser ? 'user' : 'ai'}" id="msg-${index}">
                        ${this.editingMsgId === msg.id ? `
                            <div class="chat-bubble-edit-container">
                                <textarea id="editMsgTextarea-${msg.id}" class="edit-textarea">${window.escapeHtml(msg.content)}</textarea>
                                <div style="display:flex; gap:6px; justify-content:flex-end;">
                                    <button class="btn btn-primary btn-sm" onclick="window.ChatView.saveEditedMessage(${msg.id})" style="font-size:12px; padding:2px 8px;">✓</button>
                                    <button class="btn btn-secondary btn-sm" onclick="window.ChatView.editingMsgId = null; window.ChatView.renderHistory();" style="font-size:12px; padding:2px 8px;">✕</button>
                                </div>
                            </div>
                        ` : this.formatMessageContent(msg)}
                    </div>
                    
                    <!-- Inline actions -->
                    <div class="chat-message-actions">
                        ${isUser ? `
                            <button class="chat-message-action-btn" onclick="window.ChatView.startEditMessage(${msg.id})" title="${window.i18n.t('chat_edit_msg')}">✏️</button>
                        ` : ''}
                        ${(!isUser && isLastMsg) ? `
                            <button class="chat-message-action-btn" onclick="window.ChatView.regenerateAiResponse()" title="${window.i18n.t('chat_regenerate')}">🔄</button>
                        ` : ''}
                        <button class="chat-message-action-btn" onclick="window.ChatView.deleteMessage(${msg.id})" title="${window.i18n.t('chat_delete_msg')}">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');

        // Snapshot scroll position before re-rendering
        const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;

        container.innerHTML = html;
        this.updateTokenUsageIndicator();
        this.renderMath();

        if (isRestore) {
            const savedScroll = sessionStorage.getItem(`chatScrollPos_${this.activeSessionId}`);
            if (savedScroll !== null) {
                container.scrollTop = parseInt(savedScroll);
            } else {
                this.scrollToBottom();
            }
        } else {
            // Only auto-scroll if user hasn't manually scrolled up
            if (!this.userHasScrolledUp && wasAtBottom) {
                this.scrollToBottom();
            }
        }

        // Attach scroll & input listeners to save position & detect manual scroll-up instantly
        if (!container.dataset.hasScrollListener) {
            // 1. Classical scroll listener to save history position & detect scroll direction
            let lastScrollTop = container.scrollTop;
            container.addEventListener('scroll', () => {
                if (this.activeSessionId) {
                    sessionStorage.setItem(`chatScrollPos_${this.activeSessionId}`, container.scrollTop);
                }
                const currentScrollTop = container.scrollTop;
                const scrollingUp = currentScrollTop < lastScrollTop;
                lastScrollTop = currentScrollTop;

                if (scrollingUp) {
                    // Instantly lock autoscroll when user scrolls up
                    this.userHasScrolledUp = true;
                } else {
                    // Re-engage autoscroll only if scrolling down and hitting the bottom within 30px
                    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 30;
                    if (atBottom) {
                        this.userHasScrolledUp = false;
                    }
                }
            });

            // 2. Wheel listener to detect instant scroll-up intent
            container.addEventListener('wheel', (e) => {
                if (e.deltaY < 0) {
                    this.userHasScrolledUp = true;
                }
            }, { passive: true });

            // 3. Touch move listener to detect instant swipe-down (which scrolls up) intent on mobile
            let touchStartY = 0;
            container.addEventListener('touchstart', (e) => {
                if (e.touches.length > 0) {
                    touchStartY = e.touches[0].clientY;
                }
            }, { passive: true });
            container.addEventListener('touchmove', (e) => {
                if (e.touches.length > 0) {
                    const touchY = e.touches[0].clientY;
                    if (touchY > touchStartY) { // Swipe down -> scrolls up
                        this.userHasScrolledUp = true;
                    }
                }
            }, { passive: true });

            container.dataset.hasScrollListener = "true";
        }
    },

    startEditMessage(msgId) {
        // Find bubble element and record its width to lock it
        const bubbleIndex = this.messages.findIndex(m => m.id === msgId);
        const bubbleEl = document.getElementById(`msg-${bubbleIndex}`);
        let recordedWidth = null;
        if (bubbleEl) {
            recordedWidth = bubbleEl.offsetWidth;
        }

        this.editingMsgId = msgId;
        this.renderHistory();

        if (recordedWidth && bubbleEl) {
            // Re-fetch bubble element now that it's re-rendered in edit mode
            const editBubbleEl = document.getElementById(`msg-${bubbleIndex}`);
            if (editBubbleEl) {
                editBubbleEl.style.width = recordedWidth + 'px';
            }
        }

        const textarea = document.getElementById(`editMsgTextarea-${msgId}`);
        textarea?.focus();
    },

    async saveEditedMessage(msgId) {
        const textarea = document.getElementById(`editMsgTextarea-${msgId}`);
        if (!textarea) return;

        const newContent = textarea.value.trim();
        if (!newContent) return;

        this.editingMsgId = null;
        
        // Truncate messages starting from the edited message index to match backend logic
        const msgIndex = this.messages.findIndex(m => m.id === msgId);
        if (msgIndex !== -1) {
            this.messages = this.messages.slice(0, msgIndex);
        }
        
        this.messages.push({ role: 'user', content: newContent });
        this.messages.push({ role: 'assistant', content: '<div class="typing-indicator"><span></span><span></span><span></span></div>' });
        const aiMsgIndex = this.messages.length - 1;
        this.renderHistory();

        const sendBtn = document.getElementById('chatSendBtn');
        const input = document.getElementById('chatInput');
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.disabled = true;

        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
            window.app.setFastNotificationsPolling(true);
        }
        try {
            this._activeAbortController = new AbortController();
            const response = await fetch(`/api/chat/messages/${msgId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: newContent }),
                signal: this._activeAbortController.signal
            });
            await this.handleStreamingResponse(response, aiMsgIndex);
            this._activeAbortController = null;
        } catch (e) {
            console.error(e);
            this.messages[aiMsgIndex].content = `*${window.i18n.t('chat_error_connection')}: ${e.message}*`;
            this.messages[aiMsgIndex]._isError = true;
            this.renderHistory();
        } finally {
            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(false);
            }
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.disabled = false;
            const hasError = !!this.messages[aiMsgIndex]._isError;
            if (hasError) {
                // Persist error message to DB so it survives F5
                try {
                    await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                        content: this.messages[aiMsgIndex].content,
                        role: "assistant"
                    });
                } catch (e) { console.error("Failed to persist error:", e); }
            }
            await this.loadMessages();
        }
    },

    async deleteMessage(msgId) {
        const titleKey = window.i18n.t('title_deletion') || 'Suppression';
        const msgKey = window.i18n.t('chat_delete_msg_confirm') || 'Supprimer ce message ?';
        if (await showInlineConfirm(titleKey, msgKey)) {
            try {
                const resp = await fetch(`/api/chat/messages/${msgId}`, {
                    method: 'DELETE'
                });
                if (resp.ok) {
                    await this.loadMessages();
                }
            } catch (e) {
                console.error("Error deleting message:", e);
            }
        }
    },

    async regenerateAiResponse() {
        if (!this.activeSessionId) return;
        this.userHasScrolledUp = false; // Reset scroll lock on user action

        // Set last AI message bubble to typing indicator
        const aiMsgIndex = this.messages.length - 1;
        if (aiMsgIndex >= 0 && this.messages[aiMsgIndex].role === 'assistant') {
            this.messages[aiMsgIndex].content = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            this.renderHistory();
        }

        const sendBtn = document.getElementById('chatSendBtn');
        const input = document.getElementById('chatInput');
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.disabled = true;

        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
            window.app.setFastNotificationsPolling(true);
        }
        try {
            this._activeAbortController = new AbortController();
            this._streamDetached = false;
            const response = await fetch(`/api/chat/sessions/${this.activeSessionId}/regenerate`, {
                method: 'POST'
                // No signal — we never abort, letting the backend finish and save
            });
            await this.handleStreamingResponse(response, aiMsgIndex);
            this._activeAbortController = null;
        } catch (e) {
            this._activeAbortController = null;
            if (this._streamDetached) { console.log('[Chat] Regenerate completed after user left'); return; }
            if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) { console.log('[Chat] Regenerate aborted'); return; }
            console.error(e);
            if (aiMsgIndex >= 0 && this.messages && this.messages[aiMsgIndex]) {
                this.messages[aiMsgIndex].content = `*${window.i18n.t('chat_error_connection')}: ${e.message}*`;
                this.messages[aiMsgIndex]._isError = true;
                this.renderHistory();
            }
        } finally {
            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(false);
            }
            if (!this._streamDetached) {
                if (sendBtn) sendBtn.disabled = false;
                if (input) input.disabled = false;
                if (aiMsgIndex >= 0 && this.messages && this.messages[aiMsgIndex]) {
                    const hasError = !!this.messages[aiMsgIndex]._isError;
                    if (hasError) {
                        try {
                            await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                                content: this.messages[aiMsgIndex].content,
                                role: "assistant"
                            });
                        } catch (e) { console.error("Failed to persist error:", e); }
                    }
                }
                await this.loadMessages();
            }
        }
    },

    renderMath() {
        if (window.renderMathInElement) {
            renderMathInElement(document.getElementById('chatMessages'), {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "\\[", right: "\\]", display: true},
                    {left: "$", right: "$", display: false},
                    {left: "\\(", right: "\\)", display: false}
                ]
            });
        }
    },

    scrollToBottom() {
        const container = document.getElementById('chatMessages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    },

    askDefaultQuestion() {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        const role = session ? session.role : 'advisor';
        const input = document.getElementById('chatInput');
        if (!input) return;
        
        if (role === 'advisor') {
            input.value = window.i18n.t('chat_report_advisor');
        } else if (role === 'simulator') {
            input.value = window.i18n.t('chat_report_simulator');
        } else if (role === 'alerts') {
            input.value = window.i18n.t('chat_report_alerts');
        } else if (role === 'optimizer') {
            input.value = window.i18n.t('chat_report_optimizer');
        } else if (role === 'budget_planner') {
            input.value = window.i18n.t('chat_report_budget_planner');
        } else if (role === 'forecaster') {
            input.value = window.i18n.t('chat_report_forecaster');
        } else if (role === 'auditor') {
            input.value = window.i18n.t('chat_report_auditor');
        }
        
        this.sendMessage();
    },

    updateTokenUsageIndicator() {
        const indicator = document.getElementById('chatTokenIndicator');
        if (!indicator) return;

        const percent = Math.min(100, Math.round((this.tokenUsage.used / this.tokenUsage.limit) * 100));
        let color = '#10b981'; // Green
        if (percent >= 75) {
            color = '#ef4444'; // Red
        } else if (percent >= 50) {
            color = '#f59e0b'; // Orange
        }

        indicator.style.color = color;
        // i18n label
        const txt = window.i18n.t('chat_context_tokens') || 'Mémoire : {used} / {limit} tokens ({percent}%)';
        indicator.textContent = txt
            .replace('{used}', this.tokenUsage.used.toLocaleString())
            .replace('{limit}', this.tokenUsage.limit.toLocaleString())
            .replace('{percent}', percent);
    },

    async openActionModal(txId) {
        const actionObj = this.pendingActions[txId];
        if (!actionObj) return;

        let currentTx = null;
        try {
            const resp = await fetch(`/api/transactions/${txId}`);
            if (resp.ok) currentTx = await resp.json();
        } catch(e) {}

        const fieldLabels = { category: window.i18n.t('field_label_category'), description: window.i18n.t('field_label_description'), amount: window.i18n.t('field_label_amount'), date_operation: window.i18n.t('field_label_date') };

        let detailsHtml = `<strong>Transaction #${actionObj.id}</strong>`;
        if (currentTx?.description) detailsHtml += ` — <em>${currentTx.description}</em>`;
        detailsHtml += `<table style="width:100%; margin-top:12px; border-collapse:collapse; font-size:12px;">`;
        detailsHtml += `<thead><tr>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_field">${window.i18n.t('chat_th_field')}</th>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_before">${window.i18n.t('chat_th_before')}</th>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_after">${window.i18n.t('chat_th_after')}</th>
        </tr></thead><tbody>`;

        for (const [key, newVal] of Object.entries(actionObj.updates || {})) {
            const label = fieldLabels[key] || key;
            const oldVal = currentTx ? (currentTx[key] ?? '<em>vide</em>') : '...';
            detailsHtml += `<tr>
                <td style="padding:6px 8px; font-weight:600;">${label}</td>
                <td style="padding:6px 8px; color:var(--text-muted); text-decoration:line-through;">${oldVal}</td>
                <td style="padding:6px 8px; color:var(--accent); font-weight:600;">${newVal}</td>
            </tr>`;
        }
        detailsHtml += `</tbody></table>`;

        document.getElementById('aiActionDetails').innerHTML = detailsHtml;
        document.getElementById('aiActionModal').style.display = 'flex';
        document.getElementById('aiActionConfirmBtn').onclick = () => this.applyAiAction(actionObj);
    },

    closeActionModal() {
        document.getElementById('aiActionModal').style.display = 'none';
    },

    async applyAiAction(actionObj) {
        const btn = document.getElementById('aiActionConfirmBtn');
        btn.disabled = true;
        btn.innerText = window.i18n.t('msg_applying');

        try {
            const response = await fetch(`/api/transactions/${actionObj.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actionObj.updates)
            });

            if (!response.ok) throw new Error("Erreur API");

            this.closeActionModal();
            
            // Add a feedback message in DB and reload
            const successMsg = `✅ La transaction **#${actionObj.id}** a été mise à jour avec succès dans la base de données.`;
            await fetch(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: successMsg, lang: window.i18n.lang || 'fr' })
            });
            await this.loadMessages();

        } catch (error) {
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_edit_error', {error: error.message}));
        } finally {
            btn.disabled = false;
            btn.innerText = window.i18n.t('btn_validate_edit');
        }
    },

    async sendMessage() {
        if (!this.activeSessionId) return;
        this.userHasScrolledUp = false; // Reset scroll lock on user action

        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;

        // Add user message
        this.messages.push({ role: 'user', content: text });
        input.value = '';
        input.style.height = 'auto';
        
        // Add empty AI message placeholder
        this.messages.push({ role: 'assistant', content: '<div class="typing-indicator"><span></span><span></span><span></span></div>' });
        const aiMsgIndex = this.messages.length - 1;
        
        const is_first_exchange = (this.messages.length <= 2);
        this.renderHistory();
        
        const sendBtn = document.getElementById('chatSendBtn');
        sendBtn.disabled = true;
        input.disabled = true;

        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
            window.app.setFastNotificationsPolling(true);
        }
        try {
            // Track active stream so destroy() knows generation is in progress
            this._activeAbortController = new AbortController();
            this._streamDetached = false;
            const response = await fetch(`/api/chat/sessions/${this.activeSessionId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: text,
                    lang: window.i18n.lang || 'fr'
                })
                // No signal — we never abort, letting the backend finish and save
            });

            await this.handleStreamingResponse(response, aiMsgIndex);
            this._activeAbortController = null;

        } catch (e) {
            this._activeAbortController = null;
            if (this._streamDetached) {
                // User navigated away — backend will save response and create notification
                console.log('[Chat] Stream completed after user left the view');
                return;
            }
            if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
                console.log('[Chat] Stream aborted');
                return;
            }
            console.error(e);
            if (this.messages && this.messages[aiMsgIndex]) {
                this.messages[aiMsgIndex].content = `*${window.i18n.t('chat_error_connection') || "Erreur de connexion"}: ${e.message}*`;
                this.messages[aiMsgIndex]._isError = true;
                this.renderHistory();
            }
        } finally {
            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(false);
            }
            // Guard DOM access — elements may not exist if user left the view
            if (!this._streamDetached) {
                const sendBtnF = document.getElementById('chatSendBtn');
                const inputF = document.getElementById('chatInput');
                if (sendBtnF) sendBtnF.disabled = false;
                if (inputF) { inputF.disabled = false; inputF.focus(); }
                
                const hasError = this.messages && this.messages[aiMsgIndex] && !!this.messages[aiMsgIndex]._isError;
                
                if (hasError) {
                    try {
                        await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                            content: this.messages[aiMsgIndex].content,
                            role: "assistant"
                        });
                    } catch (e) { console.error("Failed to persist error:", e); }
                }
                
                if (is_first_exchange) {
                    await this.loadSessions(hasError);
                    setTimeout(() => this.loadSessions(true), 6000);
                } else {
                    await this.loadMessages();
                }
            }
        }
    },

    async handleStreamingResponse(response, aiMsgIndex) {
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "API Error");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        let done = false;
        let aiText = '';
        this.userHasScrolledUp = false; // Reset at the start of streaming

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6).trim();
                        if (dataStr === '[DONE]') {
                            done = true;
                            break;
                        }
                        let streamError = null;
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.error) {
                                streamError = data.error;
                                aiText += `\n**Erreur:** ${data.error}`;
                            } else if (data.content) {
                                if (!this._streamDetached && this.messages[aiMsgIndex]) {
                                    delete this.messages[aiMsgIndex].status;
                                }
                                aiText += data.content;
                            } else if (data.status) {
                                if (!this._streamDetached && this.messages[aiMsgIndex]) {
                                    this.messages[aiMsgIndex].status = data.status;
                                    this.renderHistory();
                                }
                            } else if (data.token_usage) {
                                this.tokenUsage = data.token_usage;
                            }
                        } catch (e) {
                            console.error("Parse error on chunk:", dataStr);
                        }
                        if (streamError && !this._streamDetached) {
                            throw new Error(streamError);
                        }
                    }
                }

                // Skip DOM updates if stream is detached (user left the view)
                if (this._streamDetached) continue;

                // Detect if user has scrolled up before updating content and scrolling
                const container = document.getElementById('chatMessages');
                if (container && !this.userHasScrolledUp) {
                    // If the user is more than 150px away from the bottom, they scrolled up
                    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 150;
                    if (!isAtBottom) {
                        this.userHasScrolledUp = true;
                    }
                }

                // Update UI live
                if (this.messages[aiMsgIndex]) {
                    this.messages[aiMsgIndex].content = aiText;
                }
                
                const bubble = document.getElementById(`msg-${aiMsgIndex}`);
                if (bubble) {
                    bubble.innerHTML = this.formatMessageContent(this.messages[aiMsgIndex]);
                    this.renderMath();
                }

                if (!this.userHasScrolledUp) {
                    this.scrollToBottom();
                }
                this.updateTokenUsageIndicator();
            }
        }

        // Bug 1 fix: Show error if AI returned nothing (only if not detached)
        if (!this._streamDetached && !aiText.trim() && this.messages[aiMsgIndex]) {
            this.messages[aiMsgIndex].content = `⚠️ ${window.i18n.t('chat_error_empty_response') || "L'IA n'a pas répondu. Vérifiez votre configuration Ollama dans les paramètres."}`;
            this.messages[aiMsgIndex]._isError = true;
            this.renderHistory();
        }
    }
};
