"""Signature des modules bancaires woob : vérification, épinglage du trousseau, actualisation de l'index. Sans réseau."""

import base64
import hashlib
import io
import os
import pathlib
import struct
import tarfile
import time
from types import SimpleNamespace

import pytest
import requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed
from woob import __version__ as WOOB_VERSION
from woob.core.repositories import Keyring, Repositories
from woob.exceptions import BrowserHTTPNotFound, ModuleInstallError

from app.services.bank_sync import woob_adapter, woob_trust
from app.services.bank_sync.openpgp_verify import OpenPGPError, verify_detached

URL = woob_trust.TRUSTED_REPOSITORY_URL
KEYRING_NAME = Repositories.url2filename(URL)
ROOT = pathlib.Path(__file__).resolve().parents[1]

# Signature réelle de trusted.gpg, téléchargée sur updates.woob.tech
REAL_KEYRING_SIG = base64.b64decode(
    "iQEzBAABCgAdFiEE8n20G3MBpB6Qzs4v8a5sCGs03G0FAmBprJsACgkQ8a5sCGs03G2ryQgApux5NGfdpXbjqOpWLmmfVXxK4El6KTDK0W6rNt"
    "+r0b5L21W7vvpWWuGFSU1esO1KwiEJeA6uIkAfTyP67aolIrnFZJFDdfIeJWR5cBIIcrb0rL+KHEk+/YZ6FJGVluoz0fwQYAho98pGUYxyRwqM"
    "63PdNDe2fBWvR15odQ3wyXa7lmUxjXtezx0yUVtPmT5W6PkyLC4DBoARFOyyvpxahQp053fN4n11UxIf+5nC/69Jpi6GY22hXaVpkAilFyDaFS"
    "wtP2Xr/aQy+S8AIKLXFx6TmmFFgIPkwbmhfQu89Cam3Vjf/61qObKl0T8+TSPEnv7SEVSe+k8ojJwXAaYfdQ=="
)


def _packet(tag, body):
    return bytes([0xC0 | tag, 255]) + struct.pack(">I", len(body)) + body


def _mpi(value):
    return struct.pack(">H", value.bit_length()) + value.to_bytes((value.bit_length() + 7) // 8, "big")


def _subpacket(kind, value, critical=False):
    return bytes([len(value) + 1, kind | (0x80 if critical else 0)]) + value


class TestKey:
    __test__ = False

    def __init__(self, created=1_000_000_000):
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        numbers = self.private.public_key().public_numbers()
        self.body = b"\x04" + struct.pack(">I", created) + b"\x01" + _mpi(numbers.n) + _mpi(numbers.e)
        self.created = created
        self.fingerprint = hashlib.sha1(b"\x99" + struct.pack(">H", len(self.body)) + self.body).digest()

    def keyring(self, *extra):
        return _packet(6, self.body) + b"".join(extra)

    def signature(self, data, sigclass=0, hash_algo=10, extra_hashed=b"", created=None, hasher=None):
        hashed = _subpacket(33, b"\x04" + self.fingerprint) + _subpacket(2, struct.pack(">I", created or int(time.time()))) + extra_hashed
        head = bytes([4, sigclass, 1, hash_algo]) + struct.pack(">H", len(hashed)) + hashed
        digest = (hasher or hashlib.sha512)(data + head + b"\x04\xff" + struct.pack(">I", len(head))).digest()
        prehash = {8: hashes.SHA256, 9: hashes.SHA384, 10: hashes.SHA512}.get(hash_algo, hashes.SHA512)
        value = self.private.sign(digest, padding.PKCS1v15(), Prehashed(prehash())) if hasher is None else b"\x01" * 256
        return _packet(2, head + b"\x00\x00" + digest[:2] + _mpi(int.from_bytes(value, "big")))


@pytest.fixture(scope="module")
def key():
    return TestKey()


# ── Vérification OpenPGP ────────────────────────────────────────────────────────


def test_real_woob_signature_against_pinned_keyring():
    keyring = (ROOT / "docker" / "woob-keyring" / f"{KEYRING_NAME}.gpg").read_bytes()
    verify_detached(keyring, REAL_KEYRING_SIG, keyring)
    with pytest.raises(OpenPGPError):
        verify_detached(keyring + b"x", REAL_KEYRING_SIG, keyring)


def test_pinned_keyring_matches_the_woob_repository_url():
    version = (ROOT / "docker" / "woob-keyring" / f"{KEYRING_NAME}.version").read_text(encoding="utf-8").strip()
    assert int(version) > 0


def test_valid_signature_accepted(key):
    verify_detached(b"module", key.signature(b"module"), key.keyring())


@pytest.mark.parametrize("mutate", [
    lambda sig: sig[:-1] + bytes([sig[-1] ^ 1]),
    lambda sig: sig[:-20],
    lambda sig: sig + sig,
    lambda sig: b"",
    lambda sig: b"\x00garbage",
])
def test_altered_signature_refused(key, mutate):
    with pytest.raises(OpenPGPError):
        verify_detached(b"module", mutate(key.signature(b"module")), key.keyring())


def test_altered_data_refused(key):
    with pytest.raises(OpenPGPError):
        verify_detached(b"module!", key.signature(b"module"), key.keyring())


def test_unknown_key_refused(key):
    with pytest.raises(OpenPGPError, match="absente du trousseau"):
        verify_detached(b"module", TestKey().signature(b"module"), key.keyring())


def test_weak_hash_refused(key):
    with pytest.raises(OpenPGPError, match="hachage"):
        verify_detached(b"module", key.signature(b"module", hash_algo=2, hasher=hashlib.sha1), key.keyring())


def test_text_signature_refused(key):
    with pytest.raises(OpenPGPError, match="binaire"):
        verify_detached(b"module", key.signature(b"module", sigclass=1), key.keyring())


def test_unknown_critical_subpacket_refused(key):
    with pytest.raises(OpenPGPError, match="critique"):
        verify_detached(b"module", key.signature(b"module", extra_hashed=_subpacket(99, b"x", critical=True)), key.keyring())


def test_revoked_key_refused(key):
    revocation = _packet(2, key.signature(b"", sigclass=0x20)[6:])
    with pytest.raises(OpenPGPError, match="révoquée"):
        verify_detached(b"module", key.signature(b"module"), key.keyring(revocation))


def test_expired_key_refused():
    key = TestKey(created=1_000_000_000)
    self_sig = _packet(2, key.signature(b"", sigclass=0x13, created=1_000_000_000, extra_hashed=_subpacket(9, struct.pack(">I", 1000)))[6:])
    keyring = key.keyring(self_sig)
    with pytest.raises(OpenPGPError, match="expirée"):
        verify_detached(b"module", key.signature(b"module"), keyring)
    verify_detached(b"module", key.signature(b"module"), keyring, now=1_000_000_500)


# ── Dépôt simulé ────────────────────────────────────────────────────────────────


def _tarball(name, pages):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for filename, content in (("__init__.py", b""), ("pages.py", pages.encode())):
            info = tarfile.TarInfo(f"{name}/{filename}")
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def _index(version=202601010000, update=202601010000, signed=1, url=None, key_update=202001010000):
    extra = f"url = {url}\n" if url else ""
    return (
        f"[DEFAULT]\nname = main\nupdate = {update}\nmaintainer = t\nsigned = {signed}\nkey_update = {key_update}\n{extra}\n"
        f"[boursorama]\nversion = {version}\ncapabilities = CapBank\ndependencies = \ndescription = d\nmaintainer = m\nlicense = l\nicon = \nwoob_spec = \n"
    )


class FakeBrowser:
    def __init__(self, files):
        self.files = files

    def open(self, url):
        name = url.rsplit("/", 1)[1]
        if self.files is None:
            raise requests.ConnectionError("réseau coupé")
        if name not in self.files:
            raise BrowserHTTPNotFound(SimpleNamespace(status_code=404, text=""))
        content = self.files[name]
        return SimpleNamespace(content=content, text=content.decode("utf-8", "replace"))


def _site(key, version=202601010000, pages="v1", **index_args):
    tar = _tarball("boursorama", pages)
    return {
        "modules.list": _index(version=version, **index_args).encode(),
        "boursorama.tar.gz": tar,
        "boursorama.tar.gz.sig": key.signature(tar),
    }


@pytest.fixture
def env(tmp_path, key, monkeypatch):
    """Dossier woob temporaire, trousseau épinglé de test, vérification Python quelle que soit la plateforme."""
    pinned = tmp_path / "pinned"
    pinned.mkdir()
    (pinned / f"{KEYRING_NAME}.gpg").write_bytes(key.keyring())
    (pinned / f"{KEYRING_NAME}.version").write_text("202001010000", encoding="utf-8")
    monkeypatch.setattr(woob_trust, "pinned_keyring_dir", lambda: pinned)
    monkeypatch.setattr(Keyring, "find_gpg", staticmethod(lambda: None))
    monkeypatch.setattr(Keyring, "find_gpgv", staticmethod(lambda: "python"))
    monkeypatch.setattr(Keyring, "is_valid", woob_trust._is_valid_without_gpg)

    def build(files=None):
        repos = Repositories(str(tmp_path / "cfg"), str(tmp_path / "data"), WOOB_VERSION)
        repos.browser = FakeBrowser(files)
        return repos

    return SimpleNamespace(build=build, data=tmp_path / "data", cfg=tmp_path / "cfg", pinned=pinned)


def _installed(repos):
    return (pathlib.Path(repos.modules_dir) / "boursorama" / "pages.py").read_text(encoding="utf-8")


def _existing_install(env, key):
    """Installation d'avant le correctif : index et module présents, sources.list présent, aucun trousseau."""
    repos = env.build(_site(key))
    assert woob_trust.refresh_module_index(repos)
    repos.install("boursorama")
    for suffix in (".gpg", ".version"):
        os.remove(os.path.join(repos.keyrings_dir, KEYRING_NAME + suffix))
    return repos


# ── Installation neuve ──────────────────────────────────────────────────────────


def test_fresh_install_opens_without_network_then_installs_verified_module(env, key):
    repos = env.build(None)  # Réseau coupé : ne doit pas lever
    assert repos.repositories == []
    assert (env.cfg / "sources.list").exists()
    assert Keyring(os.path.join(repos.keyrings_dir, KEYRING_NAME)).exists()

    repos.browser = FakeBrowser(_site(key))
    assert woob_trust.refresh_module_index(repos)
    repos.install("boursorama")
    assert _installed(repos) == "v1"


def test_tampered_module_refused_on_fresh_install(env, key):
    site = _site(key)
    site["boursorama.tar.gz"] = _tarball("boursorama", "import evil")
    repos = env.build(site)
    assert woob_trust.refresh_module_index(repos)
    with pytest.raises(ModuleInstallError, match="Invalid signature"):
        repos.install("boursorama")
    assert not (pathlib.Path(repos.modules_dir) / "boursorama").exists()


def test_module_signed_by_another_key_refused(env, key):
    repos = env.build(_site(TestKey()))
    assert woob_trust.refresh_module_index(repos)
    with pytest.raises(ModuleInstallError, match="Invalid signature"):
        repos.install("boursorama")


@pytest.mark.parametrize("index_args", [{"signed": 0}, {"url": "https://evil.example/"}, {"url": "file:////evil/share/"}])
def test_rewritten_index_refused_and_never_saved(env, key, index_args):
    repos = env.build(_site(key, **index_args))
    assert not woob_trust.refresh_module_index(repos)
    assert repos.repositories == []
    assert os.listdir(repos.repos_dir) == []
    assert env.build(None).repositories == []  # Rien non plus au redémarrage


def test_index_left_on_disk_by_woob_is_ignored_at_startup(env, key):
    repos = env.build()
    path = woob_trust.index_path(repos)
    with open(path, "w", encoding="utf-8") as f:
        f.write(_index(signed=0, url=URL))
    assert env.build().repositories == []


def test_repository_key_never_trusted_without_pinned_keyring(env, key, monkeypatch):
    monkeypatch.setattr(woob_trust, "pinned_keyring_dir", lambda: None)
    site = _site(key)
    site["trusted.gpg"] = key.keyring()
    site["trusted.gpg.sig"] = key.signature(site["trusted.gpg"])
    repos = env.build(site)
    assert not woob_trust.refresh_module_index(repos)
    assert not Keyring(os.path.join(repos.keyrings_dir, KEYRING_NAME)).exists()


# ── Installation existante ──────────────────────────────────────────────────────


def test_existing_install_gets_keyring_and_recheck(env, key):
    _existing_install(env, key)

    repos = env.build(_site(key))  # Redémarrage après mise à jour de l'application
    assert Keyring(os.path.join(repos.keyrings_dir, KEYRING_NAME)).exists()
    assert repos.versions.get("boursorama") == 0
    assert repos.get_module_info("boursorama").path == repos.modules_dir  # Toujours utilisable

    repos.install("boursorama")
    assert repos.versions.get("boursorama") == 202601010000


def test_unverifiable_existing_module_kept_when_recheck_refused(env, key):
    _existing_install(env, key)
    repos = env.build(_site(TestKey()))
    with pytest.raises(ModuleInstallError):
        repos.install("boursorama")
    assert _installed(repos) == "v1"
    assert repos.get_module_info("boursorama").path == repos.modules_dir


def test_recheck_happens_once(env, key):
    repos = _existing_install(env, key)
    repos = env.build(_site(key))
    repos.install("boursorama")
    assert env.build().versions.get("boursorama") == 202601010000


def test_tampered_keyring_on_disk_restored(env, key):
    repos = env.build(_site(key))
    path = pathlib.Path(repos.keyrings_dir) / f"{KEYRING_NAME}.gpg"
    path.write_bytes(TestKey().keyring())
    env.build()
    assert path.read_bytes() == key.keyring()


def test_upgrade_verified_and_rollback_refused(env, key):
    repos = env.build(_site(key))
    woob_trust.refresh_module_index(repos)
    repos.install("boursorama")

    repos.browser = FakeBrowser(_site(key, version=202602020000, update=202602020000, pages="v2"))
    assert woob_trust.refresh_module_index(repos)
    repos.install("boursorama")
    assert _installed(repos) == "v2"

    repos.browser = FakeBrowser(_site(key, version=202601010000, update=202601010000, pages="v1"))
    assert not woob_trust.refresh_module_index(repos)  # Index plus ancien
    assert repos.repositories[0].update == 202602020000


def test_tampered_upgrade_keeps_installed_module(env, key):
    repos = env.build(_site(key))
    woob_trust.refresh_module_index(repos)
    repos.install("boursorama")

    site = _site(key, version=202602020000, update=202602020000, pages="v2")
    site["boursorama.tar.gz"] = _tarball("boursorama", "import evil")
    repos.browser = FakeBrowser(site)
    assert woob_trust.refresh_module_index(repos)
    with pytest.raises(ModuleInstallError):
        repos.install("boursorama")
    assert _installed(repos) == "v1"
    assert repos.versions.get("boursorama") == 202601010000
    assert repos.get_module_info("boursorama").path == repos.modules_dir


@pytest.mark.parametrize("files", [None, {}, {"modules.list": b"pas un index"}])
def test_failed_refresh_keeps_index_and_modules(env, key, files):
    repos = env.build(_site(key))
    woob_trust.refresh_module_index(repos)
    repos.install("boursorama")
    before = pathlib.Path(woob_trust.index_path(repos)).read_bytes()

    repos.browser = FakeBrowser(files)
    assert not woob_trust.refresh_module_index(repos)
    assert repos.get_module_info("boursorama").path == repos.modules_dir
    assert pathlib.Path(woob_trust.index_path(repos)).read_bytes() == before
    assert env.build().get_module_info("boursorama") is not None


def test_downgraded_index_keeps_previous_index(env, key):
    repos = env.build(_site(key))
    woob_trust.refresh_module_index(repos)
    repos.browser = FakeBrowser(_site(key, signed=0, update=202603030000))
    assert not woob_trust.refresh_module_index(repos)
    assert repos.repositories[0].signed
    assert env.build().get_module_info("boursorama").signed


def test_key_rotation_needs_signature_from_pinned_key(env, key):
    new_key = TestKey()
    rotated = new_key.keyring()
    site = _site(key, update=202602020000, key_update=202602020000)
    site["trusted.gpg"] = rotated
    site["trusted.gpg.sig"] = new_key.signature(rotated)
    repos = env.build(site)
    assert not woob_trust.refresh_module_index(repos)  # Signée par la nouvelle clé seule
    assert pathlib.Path(repos.keyrings_dir, f"{KEYRING_NAME}.gpg").read_bytes() == key.keyring()

    site["trusted.gpg.sig"] = key.signature(rotated)
    assert woob_trust.refresh_module_index(repos)
    assert pathlib.Path(repos.keyrings_dir, f"{KEYRING_NAME}.gpg").read_bytes() == rotated


# ── Correctifs et rythme d'actualisation ────────────────────────────────────────


def test_disk_hotfix_reapplied_after_upgrade(env, key):
    old_line = 'return HasElement("//title")(self.doc)'
    new_line = "return HasElement('//form[@name=\"form\"]')(self.doc)"

    repos = env.build(_site(key, pages=old_line))
    woob_trust.refresh_module_index(repos)
    module_file = pathlib.Path(repos.modules_dir) / "boursorama" / "__init__.py"
    loader = SimpleNamespace(get_or_load_module=lambda name: SimpleNamespace(package=SimpleNamespace(__file__=str(module_file))))
    w = SimpleNamespace(repositories=repos, modules_loader=loader)

    woob_adapter._apply_module_hotfixes(w, "boursorama")
    assert _installed(repos) == new_line

    repos.browser = FakeBrowser(_site(key, version=202602020000, update=202602020000, pages=old_line))
    assert woob_trust.refresh_module_index(repos)
    woob_adapter._apply_module_hotfixes(w, "boursorama")
    assert repos.versions.get("boursorama") == 202602020000
    assert _installed(repos) == new_line


def test_hotfix_still_runs_when_upgrade_refused(env, key):
    old_line = 'return HasElement("//title")(self.doc)'
    repos = env.build(_site(key, pages="ok"))
    woob_trust.refresh_module_index(repos)
    repos.install("boursorama")
    pages = pathlib.Path(repos.modules_dir) / "boursorama" / "pages.py"
    pages.write_text(old_line, encoding="utf-8")

    site = _site(key, version=202602020000, update=202602020000)
    site["boursorama.tar.gz"] = _tarball("boursorama", "import evil")
    repos.browser = FakeBrowser(site)
    assert woob_trust.refresh_module_index(repos)
    module_file = pathlib.Path(repos.modules_dir) / "boursorama" / "__init__.py"
    loader = SimpleNamespace(get_or_load_module=lambda name: SimpleNamespace(package=SimpleNamespace(__file__=str(module_file))))
    woob_adapter._apply_module_hotfixes(SimpleNamespace(repositories=repos, modules_loader=loader), "boursorama")
    assert "evil" not in pages.read_text(encoding="utf-8")
    assert "form" in pages.read_text(encoding="utf-8")


def test_refresh_throttled(env, key, monkeypatch):
    calls = []
    repos = env.build(_site(key))
    woob_trust.refresh_module_index(repos)
    monkeypatch.setattr(woob_adapter, "refresh_module_index", lambda r: calls.append(r) or False)
    monkeypatch.setattr(woob_adapter, "_LAST_INDEX_ATTEMPT", 0)
    w = SimpleNamespace(repositories=repos)

    woob_adapter.refresh_index_if_due(w)
    assert calls == []  # Index du jour

    old = time.time() - 25 * 3600
    os.utime(woob_trust.index_path(repos), (old, old))
    woob_adapter.refresh_index_if_due(w)
    woob_adapter.refresh_index_if_due(w)
    assert len(calls) == 1  # Échec : pas de nouvel essai avant 5 minutes

    monkeypatch.setattr(woob_adapter, "_LAST_INDEX_ATTEMPT", time.time() - 301)
    woob_adapter.refresh_index_if_due(w)
    assert len(calls) == 2


def test_new_keys_announced_by_index_force_refresh(env, key, monkeypatch):
    calls = []
    repos = env.build(_site(key))
    woob_trust.refresh_module_index(repos)
    repos.repositories[0].key_update = 203001010000
    monkeypatch.setattr(woob_adapter, "refresh_module_index", lambda r: calls.append(r) or False)
    monkeypatch.setattr(woob_adapter, "_LAST_INDEX_ATTEMPT", 0)
    woob_adapter.refresh_index_if_due(SimpleNamespace(repositories=repos))
    assert len(calls) == 1


def test_no_refresh_without_bank_connection(monkeypatch):
    called = []
    monkeypatch.setattr(woob_adapter, "has_bank_connection", lambda: False)
    monkeypatch.setattr(woob_adapter, "get_woob", lambda: called.append(True))
    woob_adapter.refresh_index_for_bank_users()
    assert called == []


def test_guards_active_on_this_platform():
    from woob.core.repositories import Repository

    assert Repository.parse_index is woob_trust._guarded_parse_index
    assert Repositories.__init__ is woob_trust._guarded_repositories_init
    if os.name == "nt":
        assert Keyring.is_valid is woob_trust._is_valid_without_gpg
        assert Keyring.find_gpg() is None
    assert Keyring.find_gpg() or Keyring.find_gpgv()
