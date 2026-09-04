// static/js/diagnostic_reporter.js
/**
 * Privacy-preserving Diagnostic & Error Reporting engine for OmniBank Local.
 * Automatically captures frontend runtime exceptions, breadcrumbs, console errors,
 * and compiles sanitized GitHub-ready Markdown reports.
 */

window.ErrorReporter = {
    _frontendErrors: [],
    _breadcrumbs: [],
    _consoleLogs: [],
    _maxItems: 20,

    init() {
        if (this._initialized) return;
        this._initialized = true;

        // 1. Global JS runtime error listener
        window.addEventListener('error', (event) => {
            this.recordFrontendError({
                type: 'JS_ERROR',
                message: event.message || 'Unknown error',
                filename: this.sanitize(event.filename || ''),
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error && event.error.stack ? this.sanitize(event.error.stack) : null,
                timestamp: new Date().toISOString()
            });
        });

        // 2. Global Unhandled Promise Rejection listener
        window.addEventListener('unhandledrejection', (event) => {
            let reasonStr = '';
            let stackStr = null;
            if (event.reason) {
                if (typeof event.reason === 'string') {
                    reasonStr = event.reason;
                } else if (event.reason instanceof Error) {
                    reasonStr = event.reason.message || String(event.reason);
                    stackStr = event.reason.stack ? this.sanitize(event.reason.stack) : null;
                } else {
                    try {
                        reasonStr = JSON.stringify(event.reason);
                    } catch (e) {
                        reasonStr = String(event.reason);
                    }
                }
            }
            this.recordFrontendError({
                type: 'UNHANDLED_PROMISE_REJECTION',
                message: reasonStr || 'Unhandled rejected promise',
                stack: stackStr,
                timestamp: new Date().toISOString()
            });
        });

        // 3. Hook console.error and console.warn
        const origConsoleError = console.error;
        console.error = (...args) => {
            try {
                const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
                this.recordConsoleLog('ERROR', msg);
            } catch (e) {}
            origConsoleError.apply(console, args);
        };

        const origConsoleWarn = console.warn;
        console.warn = (...args) => {
            try {
                const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
                this.recordConsoleLog('WARN', msg);
            } catch (e) {}
            origConsoleWarn.apply(console, args);
        };

        // Record initial app startup breadcrumb
        this.recordBreadcrumb('SYSTEM', 'App initialized');
    },

    recordFrontendError(errObj) {
        this._frontendErrors.unshift(errObj);
        if (this._frontendErrors.length > this._maxItems) {
            this._frontendErrors.pop();
        }
    },

    recordBreadcrumb(category, message) {
        const item = {
            category,
            message: this.sanitize(message),
            timestamp: new Date().toLocaleTimeString()
        };
        this._breadcrumbs.unshift(item);
        if (this._breadcrumbs.length > this._maxItems) {
            this._breadcrumbs.pop();
        }
    },

    recordConsoleLog(level, rawMessage) {
        const item = {
            level,
            message: this.sanitize(rawMessage),
            timestamp: new Date().toLocaleTimeString()
        };
        this._consoleLogs.unshift(item);
        if (this._consoleLogs.length > this._maxItems) {
            this._consoleLogs.pop();
        }
    },

    recordApiError(endpoint, status, detail) {
        this.recordFrontendError({
            type: 'API_HTTP_ERROR',
            endpoint: this.sanitize(endpoint),
            status: status,
            detail: this.sanitize(typeof detail === 'string' ? detail : JSON.stringify(detail)),
            timestamp: new Date().toISOString()
        });
        this.recordBreadcrumb('API_FAIL', `HTTP ${status} on ${endpoint}`);
    },

    sanitize(text) {
        if (!text || typeof text !== 'string') return '';
        let s = text;
        // 1. Mask User Home Directory paths (Windows / Unix / macOS)
        s = s.replace(/[A-Za-z]:\\Users\\[^\\]+\\/gi, '~/app/');
        s = s.replace(/[A-Za-z]:\/Users\/[^/]+\//gi, '~/app/');
        s = s.replace(/\/(?:home|Users)\/[^/]+\//g, '~/app/');
        // 2. Mask Emails
        s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
        // 3. Mask IPv4
        s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
        // 4. Mask IBANs
        s = s.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, '[IBAN_ANONYMIZED]');
        // 5. Mask Passwords / Keys / Tokens
        s = s.replace(/(password|master_password|secret|token|api_key|auth)=[^&\s]+/gi, '$1=***');
        s = s.replace(/"(password|master_password|secret|token|api_key|auth)"\s*:\s*"[^"]+"/gi, '"$1": "***"');
        return s;
    },

    async generateMarkdownReport(userNote = '') {
        let backendDiag = null;
        try {
            backendDiag = await API.get('/api/diagnostics/report');
        } catch (e) {
            backendDiag = { error: 'Failed to fetch backend diagnostics: ' + (e.message || e) };
        }

        const sys = backendDiag?.system_info || {};
        const activeProfile = window.app?.activeProfileId || 'default';
        const currentView = window.app?.currentView || 'unknown';
        const screenSize = `${window.innerWidth}x${window.innerHeight} (DevicePixelRatio: ${window.devicePixelRatio || 1})`;
        const userAgent = navigator.userAgent;

        const nowUtc = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

        let md = `### 🐛 OmniBank Local - Diagnostic & Incident Report\n\n`;
        md += `**Generated at:** \`${nowUtc}\`  \n`;
        md += `**App Version:** \`v${sys.app_version || '1.0.84'}\`  \n`;
        md += `**Execution Mode:** \`${sys.execution_mode || 'Unknown'}\`  \n`;
        md += `**Operating System:** \`${sys.os_name || 'Unknown'} ${sys.os_release || ''} (${sys.architecture || ''})\`  \n`;
        md += `**Runtimes:** \`Python ${sys.python_version || 'N/A'}\` | \`SQLite ${sys.sqlite_version || 'N/A'}\` | \`Browser: ${this.sanitize(userAgent)}\`  \n`;
        md += `**UI Context:** Current View: \`${currentView}\` | Screen: \`${screenSize}\` | Active Profile: \`${activeProfile}\`  \n`;

        const feat = sys.features || {};
        md += `**Active Features:** Local AI (Ollama: \`${feat.ai_ollama ? 'Enabled' : 'Disabled'}\`) | Bank Sync (Woob: \`${feat.bank_sync_woob ? 'Active' : 'Inactive'}\`, Version: \`${feat.woob_version || 'N/A'}\`) | Org Mode: \`${feat.org_mode ? 'Enabled' : 'Disabled'}\`  \n`;
        md += `**Database Scale:** \`~${sys.database_size_mb || 0} MB\` | Accounts: \`${sys.account_count || 0}\` | Transactions Volume: \`${sys.transaction_volume || '0'}\`  \n\n`;

        if (userNote && userNote.trim()) {
            md += `#### 💬 User Description of the Issue\n`;
            md += `> ${this.sanitize(userNote.trim()).replace(/\n/g, '\n> ')}\n\n`;
        }

        // Recent Frontend Errors
        if (this._frontendErrors.length > 0) {
            md += `#### 🚨 Last Frontend Exceptions (${this._frontendErrors.length})\n`;
            this._frontendErrors.slice(0, 5).forEach((err, idx) => {
                md += `**#${idx + 1} [${err.type}]** at \`${err.timestamp}\`\n`;
                md += `> \`${err.message || err.detail || 'No message'}\`\n`;
                if (err.filename) md += `> *Source:* \`${err.filename}:${err.lineno}:${err.colno}\`\n`;
                if (err.stack) {
                    md += `\`\`\`javascript\n${err.stack.trim()}\n\`\`\`\n`;
                }
            });
            md += `\n`;
        } else {
            md += `#### 🚨 Last Frontend Exceptions\n*None captured.*\n\n`;
        }

        // Recent Backend Exceptions
        const backExceptions = backendDiag?.recent_exceptions || [];
        if (backExceptions.length > 0) {
            md += `#### ⚙️ Last Backend Exceptions (${backExceptions.length})\n`;
            backExceptions.slice(0, 5).forEach((exc, idx) => {
                md += `**#${idx + 1} [${exc.type}]** at \`${exc.timestamp}\` (Context: \`${exc.context || 'None'}\`)\n`;
                md += `> \`${exc.message}\`\n`;
                if (exc.traceback) {
                    md += `\`\`\`python\n${exc.traceback.trim()}\n\`\`\`\n`;
                }
            });
            md += `\n`;
        }

        // Active Alerts & Incident Notifications
        const backAlerts = backendDiag?.recent_alerts || [];
        if (backAlerts.length > 0) {
            md += `#### 🔔 Active Alerts & Incident Notifications (${backAlerts.length})\n`;
            backAlerts.forEach((a, idx) => {
                const readStatus = a.is_read ? 'Read' : 'Unread';
                md += `**#${idx + 1} [${a.type}]** \`${a.title}\` (${a.created_at || 'Recent'} - ${readStatus})\n`;
                if (a.content) {
                    md += `> ${a.content}\n`;
                }
            });
            md += `\n`;
        }

        // Bank Connections & Sync Health
        const bankConns = backendDiag?.bank_connections || [];
        if (bankConns.length > 0) {
            md += `#### 🏦 Bank Sync Status & Connections (${bankConns.length})\n`;
            bankConns.forEach(c => {
                let statusBadge = '✅ Active';
                if (c.last_sync_status && c.last_sync_status.includes('error')) {
                    statusBadge = '⚠️ Sync Error';
                } else if (!c.is_active) {
                    statusBadge = '⏸️ Inactive';
                } else if (!c.last_sync_status) {
                    statusBadge = 'ℹ️ Never synced';
                }

                md += `- **${c.label}** (\`${c.backend}\`): ${statusBadge} | Status: \`${c.last_sync_status || 'idle'}\` | Last sync: \`${c.last_sync_at || 'Never'}\`\n`;
                if (c.last_error) {
                    md += `  > ⚠️ *Last Error:* \`${c.last_error}\`\n`;
                }
            });
            md += `\n`;
        }

        // User Action Breadcrumbs
        if (this._breadcrumbs.length > 0) {
            md += `#### 🐾 Recent User Action Breadcrumbs (Last ${this._breadcrumbs.length})\n\`\`\`\n`;
            this._breadcrumbs.slice().reverse().forEach(b => {
                md += `[${b.timestamp}] [${b.category}] ${b.message}\n`;
            });
            md += `\`\`\`\n\n`;
        }

        // Recent Backend Logs
        const backLogs = backendDiag?.recent_logs || [];
        if (backLogs.length > 0) {
            md += `#### 📜 Recent Backend Logs (Last ${backLogs.length})\n\`\`\`\n`;
            backLogs.slice(-15).forEach(l => {
                let msg = l.message || '';
                if (l.level && l.logger) {
                    const prefixPattern = new RegExp(`^\\[${l.level}\\]\\s*\\[${l.logger}\\]\\s*`, 'i');
                    msg = msg.replace(prefixPattern, '');
                }
                md += `[${l.timestamp}] [${l.level}] [${l.logger}] ${msg}\n`;
            });
            md += `\`\`\`\n\n`;
        }

        md += `---\n*(Note: This report has been automatically sanitized to remove personal accounts, absolute paths, and financial transaction values)*\n`;

        return md;
    },

    async copyReportToClipboard(userNote = '') {
        try {
            const report = await this.generateMarkdownReport(userNote);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(report);
            } else {
                // Fallback for older webviews
                const ta = document.createElement('textarea');
                ta.value = report;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            const successMsg = window.i18n?.t('diag_copied_toast') || '📋 Rapport copié dans le presse-papier ! Vous pouvez le coller dans une Issue GitHub.';
            if (typeof showToast === 'function') {
                showToast(successMsg, 'success', 5000);
            } else {
                alert(successMsg);
            }
            return true;
        } catch (e) {
            console.error('[ErrorReporter] Failed to copy report:', e);
            if (typeof showToast === 'function') {
                showToast('Échec de la copie du rapport : ' + (e.message || e), 'error');
            }
            return false;
        }
    },

    async openGitHubIssue(userNote = '') {
        try {
            const report = await this.generateMarkdownReport(userNote);
            const title = encodeURIComponent('[Bug Report] ' + (userNote ? userNote.substring(0, 50) : 'Incident report'));
            const body = encodeURIComponent(report);
            const issueUrl = `https://github.com/Aschefr/OmniBank-Local/issues/new?title=${title}&body=${body}`;
            window.open(issueUrl, '_blank');
        } catch (e) {
            console.error('[ErrorReporter] Failed to open GitHub issue:', e);
            window.open('https://github.com/Aschefr/OmniBank-Local/issues/new', '_blank');
        }
    },

    async clearLogs() {
        this._frontendErrors = [];
        this._breadcrumbs = [];
        this._consoleLogs = [];
        try {
            await API.post('/api/diagnostics/clear');
        } catch (e) {}
        if (typeof showToast === 'function') {
            showToast(window.i18n?.t('diag_cleared_toast') || 'Historique des logs réinitialisé.', 'info');
        }
    }
};

// Initialize listeners on script load
window.ErrorReporter.init();
