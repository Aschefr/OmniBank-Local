// static/js/views/config/config_diagnostics.js
/**
 * Configuration sub-module: Diagnostics & Bug Reporting.
 * Allows users to inspect, preview, and 1-click copy privacy-preserving
 * incident reports for GitHub Issues.
 */

window.ConfigDiagnostics = {
    render() {
        return `
            <div id="configDiagSection" class="config-card config-diag-section" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); transition: border-color 0.3s ease;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <h3 style="display: flex; align-items: center; gap: 8px; margin: 0;" data-i18n="config_diag_title">
                        🛠️ ${window.i18n?.t('config_diag_title') || 'Diagnostics & Rapport d\'Incident'}
                    </h3>
                    <span style="font-size: 11px; background: rgba(99, 102, 241, 0.15); color: var(--accent); padding: 3px 8px; border-radius: 6px; font-weight: 600;">
                        Zero-Cloud Privacy 🛡️
                    </span>
                </div>
                
                <p style="color: var(--text-muted); font-size: 13px; line-height: 1.5; margin-bottom: 16px;" data-i18n="config_diag_desc">
                    ${window.i18n?.t('config_diag_desc') || 'OmniBank fonctionne sans aucun serveur externe ni télémétrie. En cas de comportement inattendu ou de bug, vous pouvez générer un rapport technique 100% anonymisé (sans aucune donnée financière personnelle ni chemin local) prêt à être collé dans une Issue GitHub.'}
                </p>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;" data-i18n="config_diag_note_label">
                        ${window.i18n?.t('config_diag_note_label') || 'Description du problème constaté (Optionnel) :'}
                    </label>
                    <textarea id="diag_user_note" class="inline-input" rows="2" style="width: 100%; border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; font-size: 13px; resize: vertical; box-sizing: border-box;" placeholder="${window.i18n?.t('config_diag_note_placeholder') || 'Ex: Le solde prévisionnel ne s\'actualise pas après rapprochement...'}"></textarea>
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px;">
                    <button class="btn btn-primary" onclick="window.ConfigDiagnostics.copyReport()" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; padding: 8px 16px; border-radius: 8px;">
                        <span>📋</span> <span data-i18n="config_diag_copy_btn">${window.i18n?.t('config_diag_copy_btn') || 'Copier le rapport d\'incident'}</span>
                    </button>
                    <button class="btn btn-secondary" onclick="window.ConfigDiagnostics.openGitHub()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px;">
                        <span>🐙</span> <span data-i18n="config_diag_github_btn">${window.i18n?.t('config_diag_github_btn') || 'Créer une Issue GitHub'}</span>
                    </button>
                    <button class="btn btn-secondary" onclick="window.ConfigDiagnostics.togglePreview()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px;">
                        <span>🔍</span> <span id="diag_preview_toggle_text" data-i18n="config_diag_preview_btn">${window.i18n?.t('config_diag_preview_btn') || 'Prévisualiser le rapport'}</span>
                    </button>
                    <button class="btn btn-secondary" onclick="window.ConfigDiagnostics.clearLogs()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px; margin-left: auto; color: var(--text-muted);">
                        <span>🧹</span> <span data-i18n="config_diag_clear_btn">${window.i18n?.t('config_diag_clear_btn') || 'Vider les logs'}</span>
                    </button>
                </div>

                <div id="diag_preview_container" style="display: none; margin-top: 15px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_diag_preview_title">${window.i18n?.t('config_diag_preview_title') || 'Aperçu du Markdown Anonymisé'}</span>
                        <button class="btn btn-sm btn-secondary" onclick="window.ConfigDiagnostics.refreshPreview()" style="font-size: 11px; padding: 2px 8px;">🔄 <span data-i18n="config_diag_refresh_preview">${window.i18n?.t('config_diag_refresh_preview') || 'Rafraîchir'}</span></button>
                    </div>
                    <pre id="diag_preview_content" style="max-height: 250px; overflow-y: auto; font-family: monospace; font-size: 11px; line-height: 1.4; color: #e2e8f0; margin: 0; white-space: pre-wrap; word-break: break-all;"></pre>
                </div>
            </div>
        `;
    },

    async copyReport() {
        const note = document.getElementById('diag_user_note')?.value || '';
        if (window.ErrorReporter) {
            await window.ErrorReporter.copyReportToClipboard(note);
        }
    },

    async openGitHub() {
        const note = document.getElementById('diag_user_note')?.value || '';
        if (window.ErrorReporter) {
            await window.ErrorReporter.openGitHubIssue(note);
        }
    },

    async togglePreview() {
        const container = document.getElementById('diag_preview_container');
        const toggleText = document.getElementById('diag_preview_toggle_text');
        if (!container) return;
        if (container.style.display === 'none') {
            container.style.display = 'block';
            if (toggleText) toggleText.textContent = window.i18n?.t('config_diag_hide_preview') || 'Masquer l\'aperçu';
            await this.refreshPreview();
        } else {
            container.style.display = 'none';
            if (toggleText) toggleText.textContent = window.i18n?.t('config_diag_preview_btn') || 'Prévisualiser le rapport';
        }
    },

    async refreshPreview() {
        const pre = document.getElementById('diag_preview_content');
        if (!pre || !window.ErrorReporter) return;
        pre.textContent = 'Génération en cours...';
        const note = document.getElementById('diag_user_note')?.value || '';
        const md = await window.ErrorReporter.generateMarkdownReport(note);
        pre.textContent = md;
    },

    async clearLogs() {
        if (window.ErrorReporter) {
            await window.ErrorReporter.clearLogs();
            const container = document.getElementById('diag_preview_container');
            if (container && container.style.display !== 'none') {
                await this.refreshPreview();
            }
        }
    }
};
