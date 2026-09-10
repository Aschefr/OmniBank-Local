# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files

woob_datas, woob_binaries, woob_hiddenimports = collect_all('woob')
pycountry_datas, pycountry_binaries, pycountry_hiddenimports = collect_all('pycountry')
html2text_datas, html2text_binaries, html2text_hiddenimports = collect_all('html2text')
yaml_datas, yaml_binaries, yaml_hiddenimports = collect_all('yaml')
unidecode_datas, unidecode_binaries, unidecode_hiddenimports = collect_all('unidecode')
lxml_datas, lxml_binaries, lxml_hiddenimports = collect_all('lxml')

datas = [
    ('../../static', 'static'),
    ('../../CHANGELOG.md', '.'),
    ('../../package.json', '.'),
    ('../../app/services/simulator_presets.json', 'app/services'),
] + woob_datas + pycountry_datas + html2text_datas + yaml_datas + unidecode_datas + lxml_datas

hiddenimports = list(set(
    woob_hiddenimports
    + pycountry_hiddenimports
    + html2text_hiddenimports
    + yaml_hiddenimports
    + unidecode_hiddenimports
    + lxml_hiddenimports
    + [
        'woob.capabilities.bank',
        'woob.capabilities.bank.base',
        'woob.capabilities.bank.wealth',
        'woob.capabilities.bank.transfer',
        'woob.capabilities.profile',
        'woob.capabilities.bill',
        'woob.capabilities.base',
        'woob.capabilities.account',
        'woob.browser.browsers',
        'woob.browser.pages',
        'woob.browser.elements',
        'woob.browser.filters',
        'woob.browser.filters.standard',
        'woob.browser.filters.html',
        'woob.browser.filters.json',
        'woob.browser.filters.base',
        'woob.browser.cookies',
        'woob.browser.mfa',
        'woob.tools.capabilities.bank.iban',
        'woob.tools.html',
        'woob.tools.json',
        'woob.tools.pdf',
        'woob.tools.regex_helper',
        'woob.tools.request',
        'woob.tools.value',
        'woob.tools.config.yamlconfig',
    ]
))

a = Analysis(
    ['../../run_server.py'],
    pathex=[],
    binaries=woob_binaries + pycountry_binaries + html2text_binaries + yaml_binaries + unidecode_binaries + lxml_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # scipy n'est pas installé mais OpenBLAS est tiré par numpy — exclure
        'scipy',
        'scipy.special',
        # Pillow: exclure les codecs lourds inutilisés par l'app
        'PIL.AvifImagePlugin',
        'PIL.WebPImagePlugin',
        'PIL.IcnsImagePlugin',
        'PIL.SpiderImagePlugin',
        'PIL.FpxImagePlugin',
        'PIL.MicImagePlugin',
        # Tests & dev tools inutiles en production
        'pytest',
        'py',
        'unittest',
        'tkinter',
        'test',
    ],
    noarchive=False,
    optimize=0,
)

# Filtrer les binaires inutiles après l'analyse
a.binaries = [
    b for b in a.binaries
    if not any(pattern in b[0].lower() for pattern in [
        'libscipy_openblas',    # OpenBLAS pour scipy (19.5 Mo) — scipy non utilisé
        '_avif',                # AVIF codec Pillow (7.5 Mo) — inutile
        '_imagingft',           # FreeType font rendering (2 Mo) — pas de rendu texte image
        'libtiff',              # TIFF support — inutile
        'libopenjp2',           # JPEG2000 — inutile
    ])
]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='omnibank-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='omnibank-api',
)
