"""
app/reset_pin.py — Secours : supprime le code PIN d'un profil depuis la machine qui héberge OmniBank.

À utiliser si le PIN ET le code de récupération sont perdus.
Les données du profil ne sont pas modifiées ; inutile de redémarrer OmniBank.

Usage :
    python -m app.reset_pin              # liste les profils protégés
    python -m app.reset_pin <profile_id> # supprime le PIN de ce profil
Docker :
    docker exec -it <conteneur> python -m app.reset_pin <profile_id>
"""
import sys

from app.profile_manager import load_profiles_data, clear_pin, has_pin


def main(argv) -> int:
    profiles = load_profiles_data().get("profiles", [])
    protected = [p for p in profiles if has_pin(p)]

    if len(argv) < 2:
        if not protected:
            print("Aucun profil n'est protégé par un code PIN.")
            return 0
        print("Profils protégés par un code PIN :")
        for p in protected:
            print(f"  {p['id']}  ({p.get('name', '')})")
        print("\nPour supprimer un PIN : python -m app.reset_pin <profile_id>")
        return 0

    profile_id = argv[1]
    target = next((p for p in profiles if p["id"] == profile_id), None)
    if not target:
        print(f"Profil introuvable : {profile_id}")
        return 1
    if not has_pin(target):
        print(f"Le profil {profile_id} n'a pas de code PIN.")
        return 0

    clear_pin(profile_id)
    print(f"Code PIN supprimé pour le profil {profile_id} ({target.get('name', '')}).")
    print("Vous pouvez définir un nouveau PIN dans Configuration > Profils si besoin.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
