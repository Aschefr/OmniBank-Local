// static/js/views/chat/chat_stream.js — Gestion du streaming SSE, compression de contexte & saisie
window.ChatView = Object.assign(window.ChatView || {}, {
    stopGeneration() {
        this._stopRequested = true;
        if (this._streamReader) {
            try { this._streamReader.cancel(); } catch (e) {}
            this._streamReader = null;
        }
        if (this._activeAbortController) {
            this._activeAbortController.abort();
            this._activeAbortController = null;
        }
        const sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('btn-stop'); sendBtn.textContent = window.i18n.t('chat_btn_send'); sendBtn.onclick = () => this.sendMessage(); }
        const input = document.getElementById('chatInput');
        if (input) { input.disabled = false; input.focus(); }
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
        if (sendBtn) { sendBtn.classList.add('btn-stop'); sendBtn.textContent = window.i18n.t('chat_btn_stop'); sendBtn.onclick = () => this.stopGeneration(); sendBtn.disabled = false; }
        if (input) input.disabled = true;

        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
            window.app.setFastNotificationsPolling(true);
        }
        try {
            this._activeAbortController = new AbortController();
            this._streamDetached = false;
            const response = await fetch(`/api/chat/sessions/${this.activeSessionId}/regenerate`, {
                method: 'POST',
                signal: this._activeAbortController.signal
            });
            await this.handleStreamingResponse(response, aiMsgIndex);
            this._activeAbortController = null;
        } catch (e) {
            this._activeAbortController = null;
            if (this._streamDetached) { console.log('[Chat] Regenerate completed after user left'); return; }
            if (this._stopRequested || e.name === 'AbortError' || (e.message && (e.message.includes('aborted') || e.message.includes('cancel')))) { console.log('[Chat] Regenerate aborted by user'); return; }
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
                if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove('btn-stop'); sendBtn.textContent = window.i18n.t('chat_btn_send'); sendBtn.onclick = () => this.sendMessage(); }
                if (input) input.disabled = false;
                if (this._stopRequested) {
                    if (aiMsgIndex >= 0 && this.messages && this.messages[aiMsgIndex]) {
                        const stopMsg = window.i18n.t('chat_generation_stopped') || 'Generation stopped';
                        const cur = this.messages[aiMsgIndex].content || '';
                        this.messages[aiMsgIndex].content = (cur.includes('typing-indicator') || !cur.trim() ? '' : cur + '\n\n') + '🛑 _' + stopMsg + '_';
                        this.messages[aiMsgIndex].status = null;
                        delete this.messages[aiMsgIndex]._isError;
                        this._stopRequested = false;
                        this.renderHistory();

                        try {
                            await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                                content: this.messages[aiMsgIndex].content,
                                role: "assistant",
                                update_last_assistant: true
                            });
                        } catch (e) { console.error("Failed to persist cancel:", e); }
                        await this.loadMessages();
                    }
                } else {
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
        }
    },


    _updateCompressionUI() {
        const statusEl = document.getElementById('chatCompressionStatus');
        const textEl = document.getElementById('chatCompressionStatusText');
        const indicator = document.getElementById('chatTokenIndicator');
        const timelineEl = document.getElementById('chatTimelineIndicator');
        const timelineText = document.getElementById('chatTimelineIndicatorText');
        if (this.isCompressing) {
            if (statusEl) {
                statusEl.style.display = 'block';
                if (textEl) textEl.textContent = window.i18n.t('chat_compressing_in_progress');
            }
            if (indicator) indicator.style.display = 'none';
            if (timelineEl) timelineEl.style.display = 'flex';
            if (timelineText) timelineText.textContent = window.i18n.t('chat_compressing_in_progress');
        } else {
            if (statusEl) statusEl.style.display = 'none';
            if (indicator) indicator.style.display = '';
            if (timelineEl) timelineEl.style.display = 'none';
        }
        this.updateTokenUsageIndicator();
    },

    updateTokenUsageIndicator() {
        const indicator = document.getElementById('chatTokenIndicator');
        if (!indicator) return;

        if (this.isCompressing) {
            indicator.style.color = '#f59e0b';
            indicator.textContent = window.i18n.t('chat_compressing_in_progress');
            return;
        }

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

    async deleteCompressedContext() {
        if (!this.activeSessionId) return;
        try {
            const resp = await fetch(`/api/chat/sessions/${this.activeSessionId}/compressed-context`, {
                method: 'DELETE'
            });
            if (resp.ok) {
                this.confirmDeleteContext = false;
                this.editingContext = false;
                this.bubbleAfterMsgId = null;
                await this.loadMessages();
            }
        } catch (e) {
            console.error("Error deleting compressed context:", e);
        }
    },

    showRegenerateModal() {
        const modal = document.getElementById('contextRegenerateModal');
        if (!modal) return;
        document.getElementById('contextRegenerateTitle').textContent = window.i18n.t('chat_context_regenerate_title');
        document.getElementById('contextRegenerateInstruction').value = '';
        document.getElementById('contextRegenerateCancelBtn').textContent = window.i18n.t('btn_cancel');
        document.getElementById('contextRegenerateBtnLabel').textContent = window.i18n.t('chat_context_regenerate_btn');
        modal.style.display = 'flex';
    },

    closeRegenerateModal() {
        const modal = document.getElementById('contextRegenerateModal');
        if (modal) modal.style.display = 'none';
    },

    async submitRegenerate() {
        const modal = document.getElementById('contextRegenerateModal');
        const submitBtn = document.getElementById('contextRegenerateSubmitBtn');
        if (!modal || !submitBtn) return;
        const instruction = document.getElementById('contextRegenerateInstruction')?.value.trim() || '';
        submitBtn.disabled = true;
        submitBtn.textContent = window.i18n.t('chat_context_regenerating');
        try {
            const resp = await fetch(`/api/chat/sessions/${this.activeSessionId}/regenerate-compressed-context`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction })
            });
            if (resp.ok) {
                const data = await resp.json();
                this.compressedContext = data.compressed_context;
                this.editingContext = false;
                this.confirmDeleteContext = false;
                this.closeRegenerateModal();
                this.renderHistory();
            }
        } catch (e) {
            console.error("Error regenerating context:", e);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = window.i18n.t('chat_context_regenerate_btn');
        }
    },

    _checkCompressionStatus() {
        if (!this.activeSessionId || !this.isCompressing) return;
        this._stopCompressionPolling();
        this._startCompressionPolling();
    },

    _startCompressionPolling() {
        if (this._compressionPollTimer) return;
        this._compressionPollTimer = setInterval(async () => {
            try {
                const resp = await fetch(`/api/chat/sessions/${this.activeSessionId}/compression-status`);
                if (resp.ok) {
                    const data = await resp.json();
                    if (!data.compressing) {
                        this.isCompressing = false;
                        this._stopCompressionPolling();
                        await this.loadMessages();
                    }
                }
            } catch (e) {
                console.error("Compression polling error:", e);
            }
        }, 2000);
    },

    _stopCompressionPolling() {
        if (this._compressionPollTimer) {
            clearInterval(this._compressionPollTimer);
            this._compressionPollTimer = null;
        }
    },


    _updatePendingMessageUI() {
        const container = document.getElementById('pendingMessageContainer');
        const textEl = document.getElementById('pendingMessageText');
        const input = document.getElementById('chatInput');
        if (!container || !textEl || !input) return;
        if (this.pendingMessage && !this._messageReleased) {
            textEl.textContent = this.pendingMessage;
            container.style.display = 'flex';
            input.style.display = 'none';
        } else {
            container.style.display = 'none';
            input.style.display = '';
        }
    },

    _markLastUserPending() {
        // Mark the last user message and its AI placeholder as "pending" (compression in progress)
        // The bubble shows grayed out with an "en attente" badge instead of being removed
        if (!this.messages || this.messages.length < 2) return;
        const msg = this.messages[this.messages.length - 2];
        if (msg && msg.role === 'user') {
            msg._pending = true;
        }
    },

    _unmarkLastUserPending() {
        // Remove the pending marker from the last user message
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'user' && this.messages[i]._pending) {
                this.messages[i]._pending = false;
                break;
            }
        }
    },

    async sendMessage() {
        if (!this.activeSessionId) return;
        this.userHasScrolledUp = false;

        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;

        this.messages.push({ role: 'user', content: text });
        input.value = '';
        input.style.height = 'auto';
        this.messages.push({ role: 'assistant', content: '<div class="typing-indicator"><span></span><span></span><span></span></div>' });
        const aiMsgIndex = this.messages.length - 1;
        const isFirstExchange = (this.messages.length <= 2);
        this.renderHistory();

        const sendBtn = document.getElementById('chatSendBtn');
        sendBtn.classList.add('btn-stop');
        sendBtn.textContent = window.i18n.t('chat_btn_stop');
        sendBtn.onclick = () => this.stopGeneration();
        sendBtn.disabled = false;
        input.disabled = true;

        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
            window.app.setFastNotificationsPolling(true);
        }
        try {
            this._activeAbortController = new AbortController();
            this._streamDetached = false;
            const response = await fetch(`/api/chat/sessions/${this.activeSessionId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: text,
                    lang: window.i18n.lang || 'fr'
                }),
                signal: this._activeAbortController.signal
            });

            await this.handleStreamingResponse(response, aiMsgIndex);
            this._activeAbortController = null;

        } catch (e) {
            this._activeAbortController = null;
            if (this._streamDetached) {
                console.log('[Chat] Stream completed after user left the view');
                return;
            }
            if (this._stopRequested || e.name === 'AbortError' || (e.message && (e.message.includes('aborted') || e.message.includes('cancel')))) {
                console.log('[Chat] Stream aborted by user');
                return;
            }
            console.error(e);
            // Unmark pending if compression failed mid-way
            this._unmarkLastUserPending();
            if (this.messages && this.messages[aiMsgIndex]) {
                this.messages[aiMsgIndex].content = `*${window.i18n.t('chat_error_connection') || "Erreur de connexion"}: ${e.message}*`;
                this.messages[aiMsgIndex]._isError = true;
                this.renderHistory();
            }
        } finally {
            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(false);
            }
            if (!this._streamDetached) {
                const sendBtnF = document.getElementById('chatSendBtn');
                const inputF = document.getElementById('chatInput');
                if (sendBtnF) { sendBtnF.disabled = false; sendBtnF.classList.remove('btn-stop'); sendBtnF.textContent = window.i18n.t('chat_btn_send'); sendBtnF.onclick = () => this.sendMessage(); }
                if (inputF) { inputF.disabled = false; inputF.focus(); }
                
                if (this._stopRequested) {
                    if (this.messages && this.messages[aiMsgIndex]) {
                        const stopMsg = window.i18n.t('chat_generation_stopped') || 'Generation stopped';
                        const cur = this.messages[aiMsgIndex].content || '';
                        this.messages[aiMsgIndex].content = (cur.includes('typing-indicator') || !cur.trim() ? '' : cur + '\n\n') + '🛑 _' + stopMsg + '_';
                        this.messages[aiMsgIndex].status = null;
                        delete this.messages[aiMsgIndex]._isError;
                        this._stopRequested = false;
                        this.renderHistory();

                        try {
                            await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                                content: this.messages[aiMsgIndex].content,
                                role: "assistant",
                                update_last_assistant: true
                            });
                        } catch (e) { console.error("Failed to persist cancel:", e); }

                        if (isFirstExchange) {
                            await this.loadSessions(false);
                            setTimeout(() => this.loadSessions(true), 6000);
                        } else {
                            await this.loadMessages();
                        }
                    }
                } else {
                    const hasError = this.messages && this.messages[aiMsgIndex] && !!this.messages[aiMsgIndex]._isError;
                    
                    if (hasError) {
                        try {
                            await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                                content: this.messages[aiMsgIndex].content,
                                role: "assistant"
                            });
                        } catch (e) { console.error("Failed to persist error:", e); }
                    }
                    
                    if (isFirstExchange) {
                        await this.loadSessions(hasError);
                        setTimeout(() => this.loadSessions(true), 6000);
                    } else {
                        await this.loadMessages();
                    }
                }
            }
            this._unmarkLastUserPending();
            this._updatePendingMessageUI();
        }
    },

    async handleStreamingResponse(response, aiMsgIndex) {
        if (!response.ok) {
            let errMsg = `Erreur serveur (HTTP ${response.status})`;
            try {
                const err = await response.json();
                errMsg = err.detail || errMsg;
            } catch (_) {
                try {
                    const text = await response.text();
                    errMsg = text || errMsg;
                } catch (__) {}
            }
            throw new Error(errMsg);
        }

        const reader = response.body.getReader();
        this._streamReader = reader;
        const decoder = new TextDecoder('utf-8');

        let done = false;
        let aiText = '';
        this.userHasScrolledUp = false;

        try {
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
                            } else if (data.fact_update) {
                                const brainBtn = document.getElementById('chatMemoryBtn');
                                if (brainBtn) {
                                    brainBtn.classList.remove('brain-pulse-active');
                                    void brainBtn.offsetWidth; // Trigger reflow
                                    brainBtn.classList.add('brain-pulse-active');
                                    setTimeout(() => {
                                        brainBtn.classList.remove('brain-pulse-active');
                                    }, 3600);
                                }
                                showToast(`🧠 IA : Information mémorisée (${data.fact_update.key}) !`, "success", 3000);
                                const panel = document.getElementById('chatMemoryPanel');
                                if (panel && panel.classList.contains('open')) {
                                    this.fetchFacts();
                                }
                            } else if (data.clear_text) {
                                // Backend started a new tool iteration — reset the visible bubble
                                // to avoid showing stale "thinking" text from the previous round.
                                aiText = '';
                                if (!this._streamDetached && this.messages[aiMsgIndex]) {
                                    this.messages[aiMsgIndex].content = '';
                                    delete this.messages[aiMsgIndex].status;
                                }
                            } else if (data.compressing === true) {
                                this._markLastUserPending();
                                this.isCompressing = true;
                                this._updateCompressionUI();
                                this.renderHistory();
                            } else if (data.compressing === false) {
                                this.isCompressing = false;
                                this._unmarkLastUserPending();
                                if (data.compressed_context) {
                                    this.compressedContext = data.compressed_context;
                                }
                                if (data.last_compressed_message_id) {
                                    this.lastCompressedMessageId = data.last_compressed_message_id;
                                }
                                if (data.bubble_after_id) {
                                    this.bubbleAfterMsgId = data.bubble_after_id;
                                }
                                if (data.compression_stack) {
                                    this.compressionStack = data.compression_stack;
                                }
                                this._updateCompressionUI();
                                this.renderHistory();
                            }
                        } catch (e) {
                            console.error("Parse error on chunk:", dataStr);
                        }
                        if (streamError && !this._streamDetached) {
                            throw new Error(streamError);
                        }
                    }
                }

                if (this._streamDetached) continue;

                const container = document.getElementById('chatMessages');
                if (container && !this.userHasScrolledUp) {
                    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 150;
                    if (!isAtBottom) {
                        this.userHasScrolledUp = true;
                    }
                }

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

        // Auto-refresh sidebar and active view if a write tool was used
        if (aiText.includes('TOOLS_USED:')) {
            const match = aiText.match(/<!-- TOOLS_USED: ([^>]+) -->/);
            if (match && match[1]) {
                const usedTools = match[1].split(',');
                const writeTools = [
                    'apply_transaction_correction', 'create_budget_envelope', 'update_budget_envelope',
                    'delete_budget_envelope', 'allocate_savings_funds', 'create_recurrence_template',
                    'update_recurrence_template', 'delete_recurrence_template', 'create_category',
                    'delete_category', 'set_predicted_paycheck'
                ];
                const hasWriteTool = usedTools.some(t => writeTools.includes(t.trim()));
                if (hasWriteTool) {
                    console.log("[Chat] Write tool detected. Triggering UI refresh...");
                    if (window.app && typeof window.app.refreshSidebar === 'function') {
                        await window.app.refreshSidebar();
                    }
                    if (window.app && window.app.currentView && typeof window.app.currentView.loadData === 'function') {
                        try {
                            await window.app.currentView.loadData();
                        } catch (loadErr) {
                            console.error("[Chat] Failed to reload current view data:", loadErr);
                        }
                    }
                }
            }
        }

        // Bug 1 fix: Show error if AI returned nothing (only if not detached and not stopped by user)
        if (!this._streamDetached && !this._stopRequested && !aiText.trim() && this.messages[aiMsgIndex]) {
            this.messages[aiMsgIndex].content = `⚠️ ${window.i18n.t('chat_error_empty_response') || "L'IA n'a pas répondu. Vérifiez votre configuration Ollama dans les paramètres."}`;
            this.messages[aiMsgIndex]._isError = true;
            this.renderHistory();
        }
        } finally {
            this._streamReader = null;
        }
    }
});

