// static/js/components/icons.js — Icônes de l'interface : symboles Phosphor duotone du sprite #navIconSprite (index.html).
// Elles prennent la couleur du texte (currentColor), donc l'accent du profil quand le parent l'utilise.
window.Icon = function (name, size = 16, cls = '') {
    return `<svg class="ico${cls ? ' ' + cls : ''}" width="${size}" height="${size}" aria-hidden="true"><use href="#ni-${name}"/></svg>`;
};
