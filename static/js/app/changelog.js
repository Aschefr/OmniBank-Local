// static/js/app/changelog.js
// Modal du journal des modifications (changelog) et historique des versions

window.AppModules = window.AppModules || {};

window.AppModules.changelog = {
    async showChangelog() {
        const modal = document.getElementById('changelogModal');
        const body = document.getElementById('changelogBody');
        const versionEl = document.getElementById('changelogVersion');
        if (!modal || !body) return;

        body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);"><div class="loading-spinner" style="margin:0 auto 10px;"></div></div>`;
        versionEl.textContent = '';
        modal.style.display = 'flex';

        try {
            const version = this._appVersion || null;
            const url = version ? `/api/changelog?version=${version}` : '/api/changelog';
            const data = await API.get(url);

            versionEl.textContent = `v${this._appVersion || data.version || '?'}`;

            if (data.history && data.history.length > 0) {
                let html = '';
                data.history.forEach((release, idx) => {
                    const rawHtml = typeof marked?.parse === 'function' ? marked.parse(release.notes) : release.notes;
                    const safeHtml = typeof DOMPurify?.sanitize === 'function' ? DOMPurify.sanitize(rawHtml) : rawHtml;
                    
                    const isLatest = idx === 0;
                    const badgeHtml = isLatest ? `<span style="background: rgba(99, 102, 241, 0.1); color: var(--accent); border: 1px solid rgba(99, 102, 241, 0.2); font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: bold; margin-left: 10px;">Dernière version</span>` : '';
                    
                    const releaseDate = release.date ? new Date(release.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
                    
                    html += `
                        <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border-color); ${isLatest ? 'background: rgba(99, 102, 241, 0.02); padding: 16px; border-radius: 12px; border: 1px solid rgba(99, 102, 241, 0.15);' : ''}">
                            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center;">
                                    <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-main);">Version ${release.version}</h4>
                                    ${badgeHtml}
                                </div>
                                <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${releaseDate}</span>
                            </div>
                            <div class="changelog-content" style="font-size: 14px; line-height: 1.8;">
                                ${safeHtml}
                            </div>
                        </div>
                    `;
                });
                body.innerHTML = `<div style="padding-right: 8px;">${html}</div>`;
                
                // Style markdown elements
                body.querySelectorAll('h1,h2,h3').forEach(h => { h.style.color = 'var(--text-color)'; h.style.marginTop = '16px'; h.style.marginBottom = '8px'; });
                body.querySelectorAll('ul').forEach(ul => { ul.style.paddingLeft = '20px'; });
                body.querySelectorAll('li').forEach(li => { li.style.marginBottom = '4px'; });
                body.querySelectorAll('code').forEach(c => { c.style.background = 'var(--bg-base)'; c.style.padding = '2px 6px'; c.style.borderRadius = '4px'; c.style.fontSize = '12px'; });
            } else if (data.notes) {
                // Render markdown (marked.js is already loaded)
                const rawHtml = typeof marked?.parse === 'function' ? marked.parse(data.notes) : data.notes;
                const safeHtml = typeof DOMPurify?.sanitize === 'function' ? DOMPurify.sanitize(rawHtml) : rawHtml;
                body.innerHTML = `<div class="changelog-content" style="font-size:14px;line-height:1.8;">${safeHtml}</div>`;
                // Style markdown elements
                body.querySelectorAll('h1,h2,h3').forEach(h => { h.style.color = 'var(--text-color)'; h.style.marginTop = '16px'; h.style.marginBottom = '8px'; });
                body.querySelectorAll('ul').forEach(ul => { ul.style.paddingLeft = '20px'; });
                body.querySelectorAll('li').forEach(li => { li.style.marginBottom = '4px'; });
                body.querySelectorAll('code').forEach(c => { c.style.background = 'var(--bg-base)'; c.style.padding = '2px 6px'; c.style.borderRadius = '4px'; c.style.fontSize = '12px'; });
            } else {
                body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">${window.i18n.t('changelog_no_notes')}</p>`;
            }
        } catch (e) {
            console.warn('[changelog] Failed to load:', e);
            body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">${window.i18n.t('changelog_no_notes')}</p>`;
        }
    },

    closeChangelog() {
        const modal = document.getElementById('changelogModal');
        if (modal) modal.style.display = 'none';
    }
};

if (window.App) {
    Object.assign(window.App.prototype, window.AppModules.changelog);
}
