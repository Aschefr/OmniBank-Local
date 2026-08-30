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


window.ChatView = Object.assign(window.ChatView || {}, {
    sessions: [],
    activeSessionId: null,
    deletingSessionId: null,
    messages: [],
    compressedContext: null,
    lastCompressedMessageId: null,
    bubbleAfterMsgId: null,
    compressionStack: null,
    isCompressing: false,
    editingContext: false,
    editingMsgId: null,
    confirmDeleteMsgId: null,
    confirmDeleteContext: false,
    pendingActions: {},
    tokenUsage: { used: 0, limit: 32768 },
    contextBubbleOpen: false,
    pendingMessage: null,
    _messageReleased: false,
    _aiMsgIndex: null,
    _creatingSession: false,
    _compressionPollTimer: null,

    render() {
        return `
            <style>
                @keyframes brain-glow {
                    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.4); background: rgba(139, 92, 246, 0.1); }
                    50% { transform: scale(1.15); box-shadow: 0 0 15px 5px rgba(139, 92, 246, 0.4); background: rgba(139, 92, 246, 0.3); }
                    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); background: rgba(139, 92, 246, 0.1); }
                }
                .brain-pulse-active {
                    animation: brain-glow 1.2s ease-in-out infinite;
                    border-color: rgba(139, 92, 246, 0.6) !important;
                }
                /* Interactive AI Entity Badges */
                .ai-entity-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 1px 7px;
                    margin: 0 2px;
                    background: rgba(99, 102, 241, 0.14);
                    border: 1px solid rgba(99, 102, 241, 0.35);
                    border-radius: 6px;
                    color: var(--text-main, #e2e8f0);
                    font-weight: 600;
                    font-size: 0.95em;
                    cursor: pointer;
                    text-decoration: none;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    vertical-align: baseline;
                }
                .ai-entity-badge:hover, .ai-entity-badge:focus {
                    background: rgba(99, 102, 241, 0.28);
                    border-color: var(--accent, #6366f1);
                    box-shadow: 0 0 10px rgba(99, 102, 241, 0.3);
                    transform: translateY(-1px);
                    outline: none;
                }
                .ai-entity-badge.type-budget {
                    background: rgba(16, 185, 129, 0.14);
                    border-color: rgba(16, 185, 129, 0.35);
                }
                .ai-entity-badge.type-budget:hover {
                    background: rgba(16, 185, 129, 0.28);
                    border-color: #10b981;
                    box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
                }
                .ai-entity-badge.type-account {
                    background: rgba(59, 130, 246, 0.14);
                    border-color: rgba(59, 130, 246, 0.35);
                }
                .ai-entity-badge.type-account:hover {
                    background: rgba(59, 130, 246, 0.28);
                    border-color: #3b82f6;
                    box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
                }
                .ai-entity-badge.type-category {
                    background: rgba(245, 158, 11, 0.14);
                    border-color: rgba(245, 158, 11, 0.35);
                }
                .ai-entity-badge.type-category:hover {
                    background: rgba(245, 158, 11, 0.28);
                    border-color: #f59e0b;
                    box-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
                }
                .ai-entity-icon {
                    font-size: 0.9em;
                    opacity: 0.9;
                }
                /* Floating Entity Popover */
                #aiEntityPopover {
                    position: fixed;
                    z-index: 9999;
                    width: 340px;
                    max-width: 90vw;
                    background: var(--bg-surface, #1e293b);
                    border: 1px solid var(--border-color, rgba(255,255,255,0.12));
                    border-radius: 12px;
                    box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
                    padding: 16px;
                    pointer-events: auto;
                    opacity: 0;
                    transform: translateY(6px) scale(0.98);
                    transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    display: none;
                    font-family: inherit;
                }
                #aiEntityPopover.visible {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                    display: block;
                }
                .app-main:has(.chat-wrapper),
                body.in-chat-view .app-main {
                    padding: 15px !important;
                    overflow: hidden !important;
                }
                .chat-wrapper {
                    display: flex;
                    height: calc(100vh - 100px);
                    height: calc(100dvh - 100px);
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    box-shadow: var(--shadow-sm);
                    overflow: hidden;
                    position: relative;
                    width: 100%;
                    max-width: 100%;
                    box-sizing: border-box;
                }
                .chat-sidebar {
                    width: 250px;
                    min-width: 250px;
                    max-width: 250px;
                    flex-shrink: 0;
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
                    min-width: 0;
                    max-width: 100%;
                    overflow: hidden;
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
                    overflow-x: hidden;
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .chat-message-row {
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    max-width: 85%;
                    width: fit-content;
                    margin-bottom: 8px;
                    word-break: break-word;
                    overflow-wrap: anywhere;
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
                    padding: 14px 18px;
                    border-radius: 12px;
                    font-size: 14px;
                    line-height: 1.6;
                    position: relative;
                    transition: box-shadow 0.2s ease;
                    width: fit-content;
                    max-width: 100%;
                    box-sizing: border-box;
                    word-break: break-word;
                    overflow-wrap: anywhere;
                }
                .chat-bubble.user {
                    background: var(--accent);
                    color: #fff;
                    border-bottom-right-radius: 4px;
                }
                .chat-bubble.user.pending {
                    opacity: 0.5;
                    pointer-events: none;
                }
                .pending-badge {
                    font-size: 10px;
                    color: #f59e0b;
                    font-weight: 600;
                    white-space: nowrap;
                    background: rgba(245,158,11,0.12);
                    padding: 2px 8px;
                    border-radius: 10px;
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
                .chat-message-actions.confirm-active {
                    opacity: 1 !important;
                }
                .chat-delete-confirm-text {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-right: 4px;
                    white-space: nowrap;
                }
                .chat-delete-confirm-btn {
                    color: var(--danger) !important;
                    border-color: var(--danger) !important;
                }
                #chatSendBtn.btn-stop {
                    background: var(--danger) !important;
                    border-color: var(--danger) !important;
                    color: #fff !important;
                    box-shadow: none !important;
                }
                .context-bubble {
                    align-self: center;
                    width: 90%;
                    max-width: 680px;
                    border: 1px solid rgba(245, 158, 11, 0.5);
                    border-left: 3px solid #f59e0b;
                    background: var(--bg-sidebar, #fefcf5);
                    background-color: var(--bg-sidebar, #fefcf5);
                    border-radius: 8px;
                    padding: 8px;
                    margin: 8px 0;
                    display: flex;
                    flex-direction: column;
                    transition: border-color 0.2s ease;
                    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.08);
                }
                .context-bubble:hover {
                    border-color: rgba(245, 158, 11, 0.6);
                }
                .context-bubble-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 14px;
                    cursor: pointer;
                    user-select: none;
                    gap: 8px;
                    background: rgba(245, 158, 11, 0.06);
                }
                .context-bubble-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    font-weight: 700;
                    color: #f59e0b;
                }
                .context-bubble-actions {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                }
                .context-bubble:hover .context-bubble-actions,
                .context-bubble-header:active .context-bubble-actions {
                    opacity: 1;
                }
                .context-action-btn {
                    background: rgba(245, 158, 11, 0.12);
                    border: 1px solid rgba(245, 158, 11, 0.25);
                    color: #f59e0b;
                    font-size: 11px;
                    cursor: pointer;
                    border-radius: 6px;
                    padding: 3px 10px;
                    white-space: nowrap;
                    transition: background 0.15s ease;
                    font-weight: 500;
                }
                .context-action-btn:hover {
                    background: rgba(245, 158, 11, 0.25);
                }
                .context-action-btn.danger:hover {
                    background: rgba(239, 68, 68, 0.15);
                    border-color: rgba(239, 68, 68, 0.4);
                    color: #ef4444;
                }
                .context-bubble-body {
                    padding: 0 14px 14px 17px;
                    display: none;
                    min-height: 20px;
                }
                .context-bubble-body.open {
                    display: block;
                }
                .context-bubble-text {
                    font-size: 12px;
                    line-height: 1.6;
                    color: #f59e0b;
                    font-style: normal;
                    white-space: pre-wrap;
                    word-break: break-word;
                    opacity: 0.9;
                }
                .compressing-indicator {
                    align-self: center;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 16px;
                    background: rgba(245, 158, 11, 0.08);
                    border: 1px solid rgba(245, 158, 11, 0.25);
                    border-radius: 10px;
                    font-size: 12px;
                    color: #f59e0b;
                    width: 90%;
                    max-width: 680px;
                    margin: 4px 0;
                }
                .context-delete-confirm {
                    font-size: 11px;
                    color: var(--text-muted);
                    display: flex;
                    align-items: center;
                    gap: 6px;
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
                /* ── Info modal : tool groups as cards ─────────────────── */
                .chat-info-groups-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .chat-info-group-card {
                    background: rgba(255,255,255,0.03);
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    padding: 14px 16px;
                }
                .chat-info-group-header {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    margin-bottom: 8px;
                }
                .chat-info-group-emoji { font-size: 22px; line-height: 1; flex-shrink: 0; }
                .chat-info-group-meta {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .chat-info-group-name {
                    font-size: 14px;
                    color: var(--text-color);
                }
                .chat-info-group-desc {
                    font-size: 12px;
                    line-height: 1.6;
                    color: var(--text-muted);
                    margin: 0 0 10px 0;
                }
                .chat-info-group-tools {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 3px;
                }
                .chat-info-tool-code {
                    font-size: 10px;
                    padding: 2px 5px;
                    background: rgba(128,128,128,0.15);
                    border-radius: 4px;
                    color: var(--text-muted);
                    display: inline-block;
                    font-family: monospace;
                    cursor: help;
                    word-break: break-word;
                }
                /* ── Memory modal : responsive table ───────────────────── */
                .ai-memory-row {
                    border-bottom: 1px solid var(--border-color);
                }
                .ai-memory-row td {
                    padding: 10px 10px;
                    vertical-align: middle;
                }
                .ai-memory-cell-key {
                    font-weight: 500;
                    font-size: 11px;
                    color: var(--text-color);
                    font-family: monospace;
                    width: 28%;
                    word-break: break-all;
                }
                .ai-memory-cell-val { width: 40%; }
                .ai-memory-cell-scope { width: 18%; white-space: nowrap; }
                .ai-memory-cell-action { width: 14%; text-align: right; white-space: nowrap; }
                .ai-memory-input {
                    border: 1px solid var(--border-color) !important;
                    padding: 5px !important;
                    font-size: 12px !important;
                    width: 100% !important;
                }
                .ai-memory-del-btn {
                    padding: 4px 8px !important;
                    font-size: 11px !important;
                    height: auto !important;
                }
                @media (max-width: 1024px) {
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
                    #chatMenuBtn {
                        display: inline-flex !important;
                        align-items: center;
                        justify-content: center;
                    }
                }
                @media (max-width: 768px) {
                    .app-main:has(.chat-wrapper),
                    body.in-chat-view .app-main {
                        padding: 6px !important;
                        overflow: hidden !important;
                    }
                    .chat-wrapper {
                        height: calc(100vh - 68px) !important;
                        height: calc(100dvh - 68px) !important;
                        border-radius: 8px !important;
                    }
                    .chat-main-header {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 8px !important;
                        padding: 10px 12px !important;
                        height: auto !important;
                    }
                    .chat-main-header > div:first-child {
                        width: 100% !important;
                        display: flex !important;
                        align-items: center !important;
                        gap: 8px !important;
                        overflow: hidden !important;
                    }
                    .chat-main-header > div:first-child h3 {
                        font-size: 13.5px !important;
                        white-space: nowrap !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        flex: 1 !important;
                    }
                    .chat-main-header > div:last-child {
                        width: 100% !important;
                        display: flex !important;
                        align-items: center !important;
                        gap: 6px !important;
                    }
                    #chatRoleSelect {
                        flex: 1 !important;
                        min-width: 130px !important;
                        font-size: 12px !important;
                        padding: 5px 8px !important;
                        height: 34px !important;
                    }
                    .chat-main-header .btn {
                        font-size: 12px !important;
                        padding: 5px 8px !important;
                        height: 34px !important;
                        white-space: nowrap !important;
                    }
                    .chat-messages {
                        padding: 12px !important;
                        gap: 10px !important;
                    }
                    .chat-message-row {
                        max-width: 95% !important;
                    }
                    .chat-bubble {
                        padding: 10px 14px !important;
                        font-size: 13px !important;
                    }
                    /* ── Modales en plein écran sur mobile ─────────── */
                    .chat-info-modal {
                        max-width: 100% !important;
                        width: 100% !important;
                        max-height: 92vh !important;
                        border-radius: 16px 16px 0 0 !important;
                        margin: 0 !important;
                        position: fixed !important;
                        bottom: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                    }
                    .chat-info-panel {
                        align-items: flex-end !important;
                    }
                    /* ── Mémoire IA : table → cards ─────────────────── */
                    .ai-memory-row {
                        display: block !important;
                        border: 1px solid var(--border-color) !important;
                        border-radius: 8px !important;
                        margin-bottom: 10px !important;
                        padding: 8px !important;
                        background: rgba(255,255,255,0.02) !important;
                    }
                    .ai-memory-row td {
                        display: flex !important;
                        align-items: center !important;
                        width: 100% !important;
                        padding: 5px 4px !important;
                        font-size: 12px !important;
                        border: none !important;
                    }
                    .ai-memory-row td::before {
                        content: attr(data-label) " :";
                        font-size: 10px !important;
                        font-weight: 700 !important;
                        color: var(--accent) !important;
                        text-transform: uppercase !important;
                        min-width: 72px !important;
                        flex-shrink: 0 !important;
                        margin-right: 8px !important;
                    }
                    .ai-memory-cell-action {
                        justify-content: flex-end !important;
                        width: auto !important;
                    }
                    .ai-memory-cell-action::before { content: "" !important; min-width: 0 !important; }
                    .ai-memory-cell-key, .ai-memory-cell-val, .ai-memory-cell-scope {
                        width: 100% !important;
                    }
                    /* Masquer le thead du tableau mémoire sur mobile */
                    #chatMemoryPanel thead { display: none !important; }
                    #chatMemoryPanel .table { border-collapse: separate; border-spacing: 0; }
                }
                @media (max-width: 600px) {
                    #aiEntityPopover {
                        position: fixed !important;
                        left: 12px !important;
                        right: 12px !important;
                        bottom: 16px !important;
                        top: auto !important;
                        width: calc(100vw - 24px) !important;
                        max-width: 460px !important;
                        margin: 0 auto !important;
                        box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
                        border-radius: 16px !important;
                        transform: translateY(20px) scale(0.98) !important;
                    }
                    #aiEntityPopover.visible {
                        transform: translateY(0) scale(1) !important;
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
                .access-badge.badge-memory {
                    background: rgba(161, 101, 255, 0.15);
                    color: #a165ff;
                    border: 1px solid rgba(161, 101, 255, 0.3);
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
                            <button class="btn btn-secondary btn-sm" id="chatMemoryBtn" onclick="window.ChatView.toggleMemoryModal()" title="${window.i18n.t('chat_btn_memory') || 'Mémoire IA'}" style="padding: 6px 10px; font-size: 14px;">🧠</button>
                            <button class="btn btn-secondary btn-sm" onclick="window.ChatView.toggleInfoPanel()" title="${window.i18n.t('chat_info_title') || 'Informations'}" style="padding: 6px 10px; font-size: 14px;">ℹ️</button>
                        </div>
                    </div>

                    <div id="chatMessages" class="chat-messages">
                        <!-- Messages dynamically rendered -->
                    </div>

                    <div id="chatTimelineIndicator" style="display:none; align-self:center; width:90%; max-width:680px; padding:8px 16px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:10px; font-size:12px; color:#f59e0b; margin:0 auto 8px;">
                        <span style="display:inline-block; width:10px; height:10px; border:2px solid #f59e0b; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:8px;"></span>
                        <span id="chatTimelineIndicatorText"></span>
                    </div>

                    <div style="padding: 15px; border-top: 1px solid var(--border-color); background: var(--bg-sidebar); display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; gap: 10px;">
                            <textarea id="chatInput" class="inline-input" data-i18n-placeholder="chat_ph_message" placeholder="Posez une question sur vos finances..." 
                                style="flex: 1; resize: none; border: 1px solid var(--border-color); padding: 12px; border-radius: 8px; min-height: 44px; max-height: 120px;" 
                                onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); window.ChatView.sendMessage(); }"></textarea>
                            
                            <div id="pendingMessageContainer" style="flex:1; display:none; flex-direction:row; align-items:center; border:1px solid var(--border-color); padding:12px; border-radius:8px; min-height:44px; background:var(--bg-surface); gap:8px;">
                                <span id="pendingMessageText" style="flex:1; font-size:14px; color:var(--text-secondary); opacity:0.7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
                                <span style="font-size:10px; color:#f59e0b; font-weight:600; white-space:nowrap;" data-i18n="chat_message_pending">${window.i18n.t('chat_message_pending')}</span>
                            </div>

                            <button class="btn btn-primary" id="chatSendBtn" onclick="window.ChatView.sendMessage()" style="padding: 0 20px;" data-i18n="chat_btn_send">
                                ${window.i18n.t('chat_btn_send')}
                            </button>
                        </div>
                        <!-- Compression Status -->
                        <div id="chatCompressionStatus" style="display:none; font-size:11px; text-align:right; font-weight:500; color:#f59e0b;">
                            <span style="display:inline-block; width:10px; height:10px; border:2px solid #f59e0b; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:4px;"></span>
                            <span id="chatCompressionStatusText"></span>
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

                    <!-- AI Memory Modal -->
                    <div id="chatMemoryPanel" class="chat-info-panel" onclick="if(event.target === this) window.ChatView.toggleMemoryModal()">
                        <div class="chat-info-modal" style="max-width: 800px; width: calc(100vw - 24px);">
                            <div class="chat-info-modal-header">
                                <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;" data-i18n="config_ai_memory_title">
                                    <span>🧠 ${window.i18n.t('config_ai_memory_title')}</span>
                                </h3>
                                <button class="chat-session-btn" onclick="window.ChatView.toggleMemoryModal()" style="font-size: 20px; background: transparent; border: none; cursor: pointer; color: var(--text-muted);">✕</button>
                            </div>

                            <div class="chat-info-modal-body">
                                <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 15px;" data-i18n="config_ai_memory_desc">
                                    ${window.i18n.t('config_ai_memory_desc')}
                                </p>
                                
                                <div style="overflow-x: auto; margin-bottom: 15px;">
                                    <table class="table" style="width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.01); border-radius: 8px;">
                                        <thead>
                                            <tr style="border-bottom: 1px solid var(--border-color);">
                                                <th style="text-align: left; padding: 10px; font-size: 11px; font-weight: bold; color: var(--accent); text-transform: uppercase;" data-i18n="config_ai_memory_col_key">Clé</th>
                                                <th style="text-align: left; padding: 10px; font-size: 11px; font-weight: bold; color: var(--accent); text-transform: uppercase;" data-i18n="config_ai_memory_col_value">Valeur</th>
                                                <th style="text-align: left; padding: 10px; font-size: 11px; font-weight: bold; color: var(--accent); text-transform: uppercase;" data-i18n="config_ai_memory_col_scope">Portée</th>
                                                <th style="text-align: right; padding: 10px;"></th>
                                            </tr>
                                        </thead>
                                        <tbody id="aiMemoryListContainer">
                                            <!-- Dynamically loaded -->
                                        </tbody>
                                    </table>
                                </div>

                                <div class="flex-row-mobile-col" style="display: flex; gap: 10px; align-items: center; background: rgba(51, 102, 255, 0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(51, 102, 255, 0.1); flex-wrap: wrap;">
                                    <div style="flex: 1; min-width: 150px;">
                                        <input type="text" id="new_fact_key" class="inline-input" placeholder="${window.i18n.t('config_ai_memory_ph_key')}" style="border: 1px solid var(--border-color); padding: 8px; font-size: 12px; width: 100%;">
                                    </div>
                                    <div style="flex: 2; min-width: 200px;">
                                        <input type="text" id="new_fact_value" class="inline-input" placeholder="${window.i18n.t('config_ai_memory_ph_value')}" style="border: 1px solid var(--border-color); padding: 8px; font-size: 12px; width: 100%;">
                                    </div>
                                    <div id="new_fact_private_container" style="display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap;">
                                        <input type="checkbox" id="new_fact_private" style="cursor: pointer;">
                                        <label for="new_fact_private" style="cursor: pointer;" data-i18n="config_ai_memory_scope_session">${window.i18n.t('config_ai_memory_scope_session')}</label>
                                    </div>
                                    <div>
                                        <button class="btn btn-primary" onclick="window.ChatView.addFactManual()" style="padding: 8px 16px; font-size: 12px; font-weight: 500; height: auto;" data-i18n="config_ai_memory_btn_add">➕ Ajouter</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Context Re-generation Modal -->
                <div id="contextRegenerateModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:2000; align-items:center; justify-content:center; backdrop-filter:blur(4px); animation:fadeIn 0.2s ease;" onclick="if(event.target===this) window.ChatView.closeRegenerateModal()">
                    <div style="background:var(--bg-sidebar); border:1px solid var(--border-color); border-radius:12px; width:95%; max-width:500px; padding:24px; box-shadow:0 20px 50px rgba(0,0,0,0.5); animation:scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1);">
                        <h3 style="margin:0 0 8px 0; font-size:16px; display:flex; align-items:center; gap:8px;">🔄 <span id="contextRegenerateTitle"></span></h3>
                        <p style="margin:0 0 16px 0; font-size:13px; color:var(--text-muted);">Le résumé actuel sera remplacé par le nouveau résumé généré.</p>
                        <textarea id="contextRegenerateInstruction" class="edit-textarea" style="min-height:80px;"></textarea>
                        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
                            <button class="btn btn-secondary" onclick="window.ChatView.closeRegenerateModal()"><span id="contextRegenerateCancelBtn"></span></button>
                            <button class="btn btn-primary" id="contextRegenerateSubmitBtn" onclick="window.ChatView.submitRegenerate()"><span id="contextRegenerateBtnLabel"></span></button>
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
        if (this._onVisualViewportChange && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this._onVisualViewportChange);
            window.visualViewport.removeEventListener('scroll', this._onVisualViewportChange);
            this._onVisualViewportChange = null;
        }
        document.body.classList.remove('in-chat-view');
    },

    async init() {
        document.body.classList.add('in-chat-view');
        this.sessions = [];
        const savedSessionId = sessionStorage.getItem('chatActiveSessionId');
        this.activeSessionId = savedSessionId ? parseInt(savedSessionId) : null;
        this.messages = [];
        this.compressedContext = null;
        this.lastCompressedMessageId = null;
        this.isCompressing = false;
        this.editingContext = false;
        this.editingMsgId = null;
        this.confirmDeleteMsgId = null;
        this.confirmDeleteContext = false;
        this.pendingActions = {};
        this.pendingMessage = null;
        this._messageReleased = false;
        this._aiMsgIndex = null;
        this.tokenUsage = { used: 0, limit: 32768 };
        this._creatingSession = false;
        this._activeAbortController = null; // Track if a stream is active
        this._streamReader = null; // Reference to active SSE reader for cancellation
        this._stopRequested = false;
        this._streamDetached = false; // True when user left view during generation
        this._compressionPollTimer = null;

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
                menuBtn.style.display = window.innerWidth <= 1024 ? 'inline-block' : 'none';
            }
        };
        setTimeout(checkViewport, 100);
        window.addEventListener('resize', checkViewport);

        // Mobile Virtual Keyboard Handling (VisualViewport API)
        if (window.visualViewport) {
            const onVisualViewportChange = () => {
                const chatWrapper = document.querySelector('.chat-wrapper');
                if (chatWrapper && window.innerWidth <= 768) {
                    const vpHeight = window.visualViewport.height;
                    chatWrapper.style.height = `${Math.max(200, vpHeight - 65)}px`;
                    const messagesEl = document.getElementById('chatMessages');
                    if (messagesEl) {
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    }
                }
            };
            window.visualViewport.addEventListener('resize', onVisualViewportChange);
            window.visualViewport.addEventListener('scroll', onVisualViewportChange);
            this._onVisualViewportChange = onVisualViewportChange;
        }

        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('focus', () => {
                setTimeout(() => {
                    const messagesEl = document.getElementById('chatMessages');
                    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
                    chatInput.scrollIntoView({ block: 'end', behavior: 'smooth' });
                }, 300);
            });
        }

        // Event delegation for AI action boxes
        document.getElementById('chatMessages')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action-id]');
            if (btn) {
                const actId = btn.dataset.actionId;
                window.ChatView.openActionModal(actId.startsWith('act_') ? actId : parseInt(actId));
            }
        });

        await this.loadSessions();
        this.populateInfoToolsList();
    },


});
