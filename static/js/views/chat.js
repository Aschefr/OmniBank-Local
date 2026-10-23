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
                    color: var(--text-main);
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
                .ai-entity-badge.type-recurrence {
                    background: rgba(168, 85, 247, 0.14);
                    border-color: rgba(168, 85, 247, 0.38);
                }
                .ai-entity-badge.type-recurrence:hover {
                    background: rgba(168, 85, 247, 0.28);
                    border-color: #a855f7;
                    box-shadow: 0 0 10px rgba(168, 85, 247, 0.3);
                }
                .ai-entity-badge.type-transaction {
                    background: rgba(6, 182, 212, 0.14);
                    border-color: rgba(6, 182, 212, 0.38);
                }
                .ai-entity-badge.type-transaction:hover {
                    background: rgba(6, 182, 212, 0.28);
                    border-color: #06b6d4;
                    box-shadow: 0 0 10px rgba(6, 182, 212, 0.3);
                }
                .ai-missing-action-box {
                    margin-top: 14px;
                    padding: 12px 14px;
                    background: rgba(245, 158, 11, 0.08);
                    border: 1px dashed rgba(245, 158, 11, 0.4);
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .ai-missing-action-info {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 1;
                    min-width: 220px;
                }
                .ai-missing-action-icon {
                    font-size: 20px;
                    line-height: 1;
                    flex-shrink: 0;
                }
                .ai-missing-action-text {
                    font-size: 12px;
                    color: var(--text-main);
                    line-height: 1.35;
                }
                .ai-missing-action-text strong {
                    color: #f59e0b;
                }
                .ai-btn-recover-action {
                    padding: 6px 14px;
                    font-size: 12px;
                    font-weight: 600;
                    border-radius: 6px;
                    background: rgba(245, 158, 11, 0.2);
                    border: 1px solid #f59e0b;
                    color: #fbbf24;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.15s ease;
                    white-space: nowrap;
                }
                .ai-btn-recover-action:hover {
                    background: rgba(245, 158, 11, 0.35);
                    color: #fff;
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
                    width: 275px;
                    min-width: 275px;
                    max-width: 275px;
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
                    position: relative;
                    padding: 8px 10px;
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    color: var(--text-color);
                    transition: background 0.15s ease;
                    min-height: 40px;
                }
                .chat-session-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }
                .chat-session-item.active {
                    background: rgba(51, 102, 255, 0.15);
                    border: 1px solid rgba(51, 102, 255, 0.3);
                }
                .chat-sidebar-group-header {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                    padding: 10px 8px 4px 8px;
                    user-select: none;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .chat-sidebar-group-header:first-child {
                    padding-top: 2px;
                }
                .chat-group-delete-btn {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    font-size: 11px;
                    opacity: 0.45;
                    padding: 2px 4px;
                    border-radius: 4px;
                    transition: opacity 0.15s, background 0.15s;
                    line-height: 1;
                }
                .chat-sidebar-group-header:hover .chat-group-delete-btn {
                    opacity: 1;
                }
                .chat-group-delete-btn:hover {
                    background: rgba(239, 68, 68, 0.2);
                    color: #ef4444;
                }
                .chat-sidebar-group-header.confirming {
                    background: rgba(239, 68, 68, 0.12);
                    border: 1px solid rgba(239, 68, 68, 0.3);
                    border-radius: 6px;
                    padding: 4px 8px;
                    margin: 4px 0;
                }
                .chat-group-confirm-label {
                    font-size: 11px;
                    font-weight: 600;
                    color: #f87171;
                    text-transform: none;
                    letter-spacing: normal;
                }
                .chat-group-confirm-actions {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .chat-group-btn-confirm {
                    background: rgba(239, 68, 68, 0.25);
                    border: 1px solid rgba(239, 68, 68, 0.5);
                    color: #fca5a5;
                    font-size: 11px;
                    padding: 2px 5px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                }
                .chat-group-btn-confirm:hover {
                    background: rgba(239, 68, 68, 0.45);
                    color: #fff;
                }
                .chat-group-btn-cancel {
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    color: var(--text-muted);
                    font-size: 11px;
                    padding: 2px 5px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .chat-group-btn-cancel:hover {
                    background: rgba(255, 255, 255, 0.18);
                    color: #fff;
                }
                .chat-session-title {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    line-height: 1.35;
                    font-size: 13px;
                    word-break: break-word;
                }
                .chat-session-title-inner {
                    display: inline;
                }
                .chat-session-item.editing {
                    background: rgba(51, 102, 255, 0.12);
                    border: 1px solid rgba(51, 102, 255, 0.4);
                    padding: 6px 8px;
                }
                .chat-session-rename-form {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    min-width: 0;
                }
                .chat-session-rename-input {
                    flex: 1;
                    min-width: 0;
                    background: var(--bg-card, #1e2230);
                    border: 1px solid rgba(51, 102, 255, 0.5);
                    border-radius: 4px;
                    color: var(--text-color, #fff);
                    font-size: 12px;
                    padding: 4px 6px;
                    outline: none;
                }
                .chat-session-rename-input:focus {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
                }
                .chat-session-rename-actions {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    flex-shrink: 0;
                }
                .chat-session-btn-save {
                    color: #10b981 !important;
                    font-size: 12px;
                    padding: 3px 6px;
                    border-radius: 4px;
                    background: rgba(16, 185, 129, 0.15) !important;
                }
                .chat-session-btn-save:hover {
                    background: rgba(16, 185, 129, 0.3) !important;
                }
                .chat-session-btn-cancel {
                    color: #ef4444 !important;
                    font-size: 12px;
                    padding: 3px 6px;
                    border-radius: 4px;
                    background: rgba(239, 68, 68, 0.15) !important;
                }
                .chat-session-btn-cancel:hover {
                    background: rgba(239, 68, 68, 0.3) !important;
                }
                .chat-session-more-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-muted, #94a3b8);
                    font-size: 16px;
                    font-weight: bold;
                    line-height: 1;
                    width: 24px;
                    height: 28px;
                    min-width: 24px;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    opacity: 0.65;
                    transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
                    padding: 0;
                    margin-left: 2px;
                    flex-shrink: 0;
                    user-select: none;
                }
                .chat-session-more-btn:hover,
                .chat-session-more-btn.active,
                .chat-session-item:hover .chat-session-more-btn {
                    opacity: 1;
                    color: var(--text-color, #fff);
                    background: rgba(255, 255, 255, 0.12);
                }
                .chat-session-dropdown {
                    position: absolute;
                    right: 6px;
                    top: calc(100% + 2px);
                    min-width: 175px;
                    max-width: 230px;
                    background: var(--bg-card, #1e2230);
                    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
                    border-radius: 8px;
                    padding: 5px;
                    box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.25);
                    z-index: 1000;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    backdrop-filter: blur(16px);
                    animation: chatDropdownFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .chat-session-dropdown.dropup {
                    top: auto;
                    bottom: calc(100% + 2px);
                }
                @keyframes chatDropdownFadeIn {
                    from {
                        opacity: 0;
                        transform: translateY(-4px) scale(0.98);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                .chat-session-dropdown-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 7px 10px;
                    border: none;
                    background: transparent;
                    color: var(--text-color, #e2e8f0);
                    font-size: 12px;
                    font-weight: 500;
                    border-radius: 6px;
                    cursor: pointer;
                    text-align: left;
                    transition: background 0.12s ease, color 0.12s ease;
                    user-select: none;
                }
                .chat-session-dropdown-item:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }
                .chat-session-dropdown-item.danger {
                    color: #f87171;
                }
                .chat-session-dropdown-item.danger:hover {
                    background: rgba(239, 68, 68, 0.18);
                    color: #ef4444;
                }
                .chat-session-dropdown-icon {
                    font-size: 13px;
                    width: 16px;
                    text-align: center;
                    flex-shrink: 0;
                }
                .chat-session-dropdown-label {
                    flex: 1;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .chat-session-dropdown-divider {
                    height: 1px;
                    background: var(--border-color, rgba(255, 255, 255, 0.08));
                    margin: 3px 0;
                }
                .chat-session-inline-confirm {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    flex-shrink: 0;
                    background: rgba(239, 68, 68, 0.15);
                    padding: 2px 4px;
                    border-radius: 6px;
                    border: 1px solid rgba(239, 68, 68, 0.35);
                }
                .chat-session-item.deleting {
                    background: rgba(239, 68, 68, 0.08);
                    border: 1px solid rgba(239, 68, 68, 0.25);
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
                    padding: 2px 4px;
                    font-size: 12px;
                    border-radius: 4px;
                    line-height: 1;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.15s, color 0.15s;
                }
                .chat-session-btn:hover {
                    color: #fff;
                    background: rgba(255, 255, 255, 0.18);
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
                    overflow-anchor: none;
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
                    background: var(--bg-surface);
                    color: var(--text-main);
                    border: 1px solid var(--border-color);
                    border-bottom-left-radius: 4px;
                    font-size: 14px;
                    line-height: 1.65;
                    letter-spacing: 0.01em;
                }
                .chat-bubble.ai p {
                    margin-top: 0;
                    margin-bottom: 16px;
                    line-height: 1.7;
                }
                .chat-bubble.ai p:last-child {
                    margin-bottom: 0;
                }
                .chat-bubble.ai h1,
                .chat-bubble.ai h2,
                .chat-bubble.ai h3,
                .chat-bubble.ai h4 {
                    font-family: inherit;
                    text-transform: uppercase !important;
                    letter-spacing: 0.04em !important;
                    color: var(--text-main);
                }
                .chat-bubble.ai h1 {
                    font-size: 1.35rem;
                    font-weight: 800;
                    margin-top: 28px;
                    margin-bottom: 14px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--border-color);
                }
                .chat-bubble.ai h2 {
                    font-size: 1.22rem;
                    font-weight: 700;
                    margin-top: 24px;
                    margin-bottom: 12px;
                    padding-bottom: 6px;
                    border-bottom: 1px solid var(--border-color);
                }
                .chat-bubble.ai h3 {
                    font-size: 1.15rem;
                    font-weight: 700;
                    margin-top: 22px;
                    margin-bottom: 12px;
                    padding-bottom: 6px;
                    border-bottom: 1px solid var(--border-color);
                    color: var(--text-main);
                }
                .chat-bubble.ai h4 {
                    font-size: 1.02rem;
                    font-weight: 600;
                    margin-top: 18px;
                    margin-bottom: 8px;
                    color: var(--accent);
                }
                body.theme-dark .chat-bubble.ai h1,
                body.theme-dark .chat-bubble.ai h2 {
                    color: #ffffff;
                }
                body.theme-dark .chat-bubble.ai h3 {
                    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
                    color: #f8fafc;
                }
                .chat-bubble.ai > h1:first-child,
                .chat-bubble.ai > h2:first-child,
                .chat-bubble.ai > h3:first-child,
                .chat-bubble.ai > h4:first-child {
                    margin-top: 0;
                }
                .chat-bubble.ai ul, .chat-bubble.ai ol {
                    padding-left: 20px;
                    margin: 12px 0 16px 0;
                }
                .chat-bubble.ai li {
                    margin-bottom: 10px;
                    line-height: 1.65;
                    padding-left: 2px;
                }
                .chat-bubble.ai li:last-child {
                    margin-bottom: 0;
                }
                .chat-bubble.ai ul > li::marker {
                    color: var(--accent);
                    font-size: 1.1em;
                }
                .chat-bubble.ai ol > li::marker {
                    color: var(--accent);
                    font-weight: 600;
                }

                /* 1-click follow-up suggestions */
                .chat-suggestions-container {
                    margin-top: 20px;
                    padding-top: 16px;
                    border-top: 1px dashed var(--border-color);
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .chat-suggestions-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--accent, #6366f1);
                }
                .chat-suggestions-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .chat-suggestion-chip {
                    display: inline-flex;
                    align-items: center;
                    text-align: left;
                    gap: 10px;
                    padding: 10px 14px;
                    background: var(--accent-subtle);
                    border: 1px solid var(--accent-border);
                    border-radius: 8px;
                    color: var(--text-main);
                    font-size: 13px;
                    line-height: 1.45;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: var(--shadow-sm);
                    font-family: inherit;
                    width: fit-content;
                    max-width: 100%;
                }
                .chat-suggestion-chip:hover {
                    background: var(--accent);
                    border-color: var(--accent);
                    color: #ffffff;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px var(--accent-glow);
                }
                .chat-suggestion-chip:active {
                    transform: translateY(0);
                }
                .chat-suggestion-chip-icon {
                    font-size: 14px;
                    flex-shrink: 0;
                    opacity: 0.9;
                }
                .chat-suggestion-chip-text {
                    flex: 1;
                }
                .chat-bubble.ai strong, .chat-bubble.ai b {
                    font-weight: 700;
                    color: var(--text-main);
                }
                body.theme-dark .chat-bubble.ai strong,
                body.theme-dark .chat-bubble.ai b {
                    color: #ffffff;
                }
                .chat-bubble.ai blockquote {
                    margin: 12px 0;
                    padding: 8px 14px;
                    background: rgba(51, 102, 255, 0.07);
                    border-left: 3px solid var(--accent);
                    border-radius: 0 8px 8px 0;
                    color: var(--text-muted);
                }
                .chat-bubble.ai blockquote p {
                    margin-bottom: 0;
                }
                .chat-bubble.ai code:not(pre code) {
                    background: var(--bg-surface-hover, rgba(0, 0, 0, 0.04));
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 0.88em;
                    color: #0369a1;
                    border: 1px solid var(--border-color);
                }
                body.theme-dark .chat-bubble.ai code:not(pre code) {
                    background: rgba(255, 255, 255, 0.08);
                    color: #38bdf8;
                    border: 1px solid rgba(255, 255, 255, 0.06);
                }
                .chat-bubble.ai hr {
                    border: 0;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, var(--border-color), transparent);
                    margin: 18px 0;
                }

                /* Markdown Tables in Chat Bubbles */
                .chat-table-wrapper {
                    width: 100%;
                    max-width: 100%;
                    overflow-x: auto;
                    margin: 14px 0;
                    border-radius: 10px;
                    border: 1px solid var(--border-color);
                    background: var(--bg-surface);
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
                    scrollbar-width: thin;
                }
                .chat-bubble table,
                .chat-markdown-table {
                    width: 100%;
                    min-width: 520px;
                    border-collapse: separate;
                    border-spacing: 0;
                    font-size: 13px;
                    line-height: 1.5;
                    text-align: left;
                    margin: 0;
                }
                .chat-bubble thead,
                .chat-markdown-table thead {
                    background: rgba(51, 102, 255, 0.08);
                }
                .chat-bubble th,
                .chat-markdown-table th {
                    padding: 11px 16px;
                    font-weight: 700;
                    font-size: 11.5px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-main);
                    border-bottom: 2px solid var(--border-color);
                    border-right: 1px solid var(--border-color);
                    white-space: nowrap;
                }
                .chat-bubble th:last-child,
                .chat-markdown-table th:last-child {
                    border-right: none;
                }
                .chat-bubble td,
                .chat-markdown-table td {
                    padding: 10px 16px;
                    border-bottom: 1px solid var(--border-color);
                    border-right: 1px solid var(--border-color);
                    color: var(--text-main);
                    font-variant-numeric: tabular-nums;
                    vertical-align: middle;
                }
                .chat-bubble td:last-child,
                .chat-markdown-table td:last-child {
                    border-right: none;
                }
                .chat-bubble tbody tr:last-child td,
                .chat-markdown-table tbody tr:last-child td {
                    border-bottom: none;
                }
                .chat-bubble tbody tr,
                .chat-markdown-table tbody tr {
                    transition: background 0.15s ease;
                }
                .chat-bubble tbody tr:nth-child(even),
                .chat-markdown-table tbody tr:nth-child(even) {
                    background: var(--bg-surface-hover);
                }
                .chat-bubble tbody tr:hover,
                .chat-markdown-table tbody tr:hover {
                    background: var(--accent-subtle);
                }
                .chat-bubble th:first-child,
                .chat-bubble td:first-child,
                .chat-markdown-table th:first-child,
                .chat-markdown-table td:first-child {
                    font-weight: 600;
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
                    color: var(--text-main);
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
                    color: var(--text-main);
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
                    color: var(--text-main);
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
                    transition: background 0.15s ease, border-color 0.15s ease;
                }
                .ai-think-details:hover {
                    background: rgba(255, 255, 255, 0.04);
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
                    transition: color 0.15s ease;
                }
                .ai-think-summary:hover {
                    color: var(--text-main);
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
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 11px;
                    padding: 2.5px 8px;
                    background: rgba(99, 102, 241, 0.12);
                    border: 1px solid rgba(99, 102, 241, 0.3);
                    border-radius: 6px;
                    color: var(--accent, #818cf8);
                    font-family: inherit;
                    font-weight: 600;
                    cursor: help;
                    transition: all 0.2s ease;
                    letter-spacing: normal;
                }
                .tool-badge:hover {
                    background: rgba(99, 102, 241, 0.22);
                    border-color: rgba(99, 102, 241, 0.5);
                    box-shadow: 0 0 8px rgba(99, 102, 241, 0.25);
                }
                .chat-info-panel {
                    display: none;
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.6);
                    z-index: 10000;
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

                /* ── Auto-Scroll Toggle Switch ── */
                .chat-autoscroll-container {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    user-select: none;
                    font-size: 11.5px;
                    font-weight: 500;
                }
                .chat-autoscroll-label {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    cursor: pointer;
                    margin: 0;
                    color: var(--text-muted);
                    transition: color 0.2s ease;
                }
                .chat-autoscroll-label:hover {
                    color: var(--text-main);
                }
                .chat-autoscroll-switch {
                    position: relative;
                    display: inline-block;
                    width: 28px;
                    height: 16px;
                    flex-shrink: 0;
                }
                .chat-autoscroll-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                    position: absolute;
                    margin: 0;
                }
                .chat-autoscroll-slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: var(--border-color, rgba(128, 128, 128, 0.35));
                    transition: background-color 0.25s ease, box-shadow 0.25s ease;
                    border-radius: 16px;
                }
                .chat-autoscroll-slider::before {
                    position: absolute;
                    content: "";
                    height: 12px;
                    width: 12px;
                    left: 2px;
                    bottom: 2px;
                    background-color: #ffffff;
                    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                    border-radius: 50%;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
                }
                .chat-autoscroll-switch input:checked + .chat-autoscroll-slider {
                    background-color: #10b981;
                }
                .chat-autoscroll-switch input:checked + .chat-autoscroll-slider::before {
                    transform: translateX(12px);
                }
                .chat-autoscroll-container.debraye .chat-autoscroll-switch input:checked + .chat-autoscroll-slider {
                    background-color: #f59e0b !important;
                    box-shadow: 0 0 8px rgba(245, 158, 11, 0.45);
                }
                .chat-autoscroll-container.debraye .chat-autoscroll-text {
                    color: #f59e0b !important;
                    font-weight: 600;
                    cursor: pointer;
                    text-decoration: underline dotted;
                    text-underline-offset: 3px;
                }
                .chat-autoscroll-container.debraye .chat-autoscroll-text:hover {
                    color: #d97706 !important;
                }
                .chat-autoscroll-container.disabled .chat-autoscroll-text {
                    color: var(--text-muted);
                    opacity: 0.75;
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
                        <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                            <button id="chatMenuBtn" class="btn btn-secondary btn-sm" onclick="window.ChatView.toggleSidebar()" style="display:none; padding:4px 8px;">
                                ☰
                            </button>
                            <h3 id="chatSessionActiveTitle" style="margin:0; font-size:16px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">...</h3>
                            <button id="chatHeaderRegenBtn" class="chat-session-btn" onclick="window.ChatView.regenerateActiveSessionTitle()" title="${window.i18n ? window.i18n.t('chat_regenerate_title') : 'Régénérer le titre avec l\'IA'}" style="padding: 3px 6px; font-size: 13px; line-height: 1;">🪄</button>
                            <button class="chat-session-btn" onclick="window.ChatView.startRenameActiveSession()" title="${window.i18n.t('chat_edit_msg') || 'Renommer'}" style="padding: 3px 6px; font-size: 13px; line-height: 1;">✏️</button>
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

                    <div style="padding: 12px 15px 10px 15px; border-top: 1px solid var(--border-color); background: var(--bg-sidebar); display: flex; flex-direction: column; gap: 8px;">
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
                        <!-- Status Bar: AutoScroll on Left, Compression & Tokens on Right -->
                        <div style="display: flex; justify-content: space-between; align-items: center; min-height: 18px; font-size: 11px;">
                            <div id="chatAutoScrollContainer" class="chat-autoscroll-container" title="${window.i18n ? window.i18n.t('chat_autoscroll_tooltip_active') : 'Auto-scroll actif lors de la génération'}">
                                <label class="chat-autoscroll-label" for="chatAutoScrollToggle">
                                    <span class="chat-autoscroll-switch">
                                        <input type="checkbox" id="chatAutoScrollToggle" checked onchange="window.ChatView.toggleAutoScroll(this.checked)">
                                        <span class="chat-autoscroll-slider"></span>
                                    </span>
                                    <span id="chatAutoScrollText" class="chat-autoscroll-text" onclick="window.ChatView.onAutoScrollTextClick(event)">${window.i18n ? window.i18n.t('chat_autoscroll_active') : 'Auto-scroll'}</span>
                                </label>
                            </div>
                            <div style="display: flex; align-items: center; gap: 12px; margin-left: auto;">
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
                <div id="contextRegenerateModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:10000; align-items:center; justify-content:center; backdrop-filter:blur(4px); animation:fadeIn 0.2s ease;" onclick="if(event.target===this) window.ChatView.closeRegenerateModal()">
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
                fetch(`/api/chat/sessions/${sessionId}/notify-on-complete`, { method: 'POST', keepalive: true }).catch(() => {});
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
        if (this._onChatVisibilityChange) {
            document.removeEventListener('visibilitychange', this._onChatVisibilityChange);
            this._onChatVisibilityChange = null;
        }
        if (this._onChatPageHide) {
            window.removeEventListener('pagehide', this._onChatPageHide);
            this._onChatPageHide = null;
        }
        if (this._onChatBeforeUnload) {
            window.removeEventListener('beforeunload', this._onChatBeforeUnload);
            this._onChatBeforeUnload = null;
        }
        document.body.classList.remove('in-chat-view');
    },

    async init() {
        document.body.classList.add('in-chat-view');
        this.sessions = [];
        const savedSessionId = window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('chatActiveSessionId') : sessionStorage.getItem('chatActiveSessionId');
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

        // Register notify-on-complete if user hides tab or unloads during generation
        this._onChatVisibilityChange = () => {
            if (document.hidden && this.isStreaming && this.activeSessionId) {
                fetch(`/api/chat/sessions/${this.activeSessionId}/notify-on-complete`, { method: 'POST', keepalive: true }).catch(() => {});
            } else if (!document.hidden && this.activeSessionId) {
                fetch(`/api/chat/sessions/${this.activeSessionId}/cancel-notify-on-complete`, { method: 'POST' }).catch(() => {});
            }
        };
        document.addEventListener('visibilitychange', this._onChatVisibilityChange);

        this._onChatBeforeUnload = () => {
            window._isPageUnloading = true;
            this._streamDetached = true;
            if (this.isStreaming && this.activeSessionId) {
                fetch(`/api/chat/sessions/${this.activeSessionId}/notify-on-complete`, { method: 'POST', keepalive: true }).catch(() => {});
            }
        };
        window.addEventListener('beforeunload', this._onChatBeforeUnload);

        this._onChatPageHide = () => {
            window._isPageUnloading = true;
            this._streamDetached = true;
            if (this.isStreaming && this.activeSessionId) {
                fetch(`/api/chat/sessions/${this.activeSessionId}/notify-on-complete`, { method: 'POST', keepalive: true }).catch(() => {});
            }
        };
        window.addEventListener('pagehide', this._onChatPageHide);

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
                if (chatWrapper) {
                    if (window.innerWidth <= 768) {
                        const vpHeight = window.visualViewport.height;
                        chatWrapper.style.height = `${Math.max(200, vpHeight - 65)}px`;
                        const messagesEl = document.getElementById('chatMessages');
                        if (messagesEl && !window.ChatView?.userHasScrolledUp && window.ChatView?.autoScrollEnabled !== false) {
                            messagesEl.scrollTop = messagesEl.scrollHeight;
                        }
                    } else if (chatWrapper.style.height) {
                        chatWrapper.style.height = '';
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
                    if (messagesEl && !window.ChatView?.userHasScrolledUp && window.ChatView?.autoScrollEnabled !== false) {
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                        chatInput.scrollIntoView({ block: 'end', behavior: 'smooth' });
                    }
                }, 300);
            });
        }

        // Event delegation for AI action boxes & suggestion chips
        document.getElementById('chatMessages')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action-id]');
            if (btn) {
                const actId = btn.dataset.actionId;
                window.ChatView.openActionModal(actId.startsWith('act_') ? actId : parseInt(actId));
                return;
            }
            const chip = e.target.closest('.chat-suggestion-chip');
            if (chip) {
                const prompt = chip.getAttribute('data-prompt');
                if (prompt) window.ChatView.sendQuickSuggestion(prompt);
                return;
            }
        });

        this.loadEntityCache?.();
        await this.loadSessions();
        this.populateInfoToolsList();
    },

    sendQuickSuggestion(promptText) {
        if (!promptText) return;
        if (this.isStreaming || this._streamReader || window.ChatView?.isStreaming || window.ChatView?._streamReader) return;
        const input = document.getElementById('chatInput');
        if (!input) return;
        input.value = promptText;
        if (typeof this.sendMessage === 'function') {
            this.sendMessage();
        } else if (window.ChatView && typeof window.ChatView.sendMessage === 'function') {
            window.ChatView.sendMessage();
        } else {
            const sendBtn = document.getElementById('chatSendBtn');
            if (sendBtn) sendBtn.click();
        }
    }
});
