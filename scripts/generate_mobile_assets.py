"""
Génère l'ensemble des icônes et splash screens natifs Android & iOS (ainsi que
les icônes Store 1024x1024 et 512x512) à partir de static/img/logo.png sur le
fond sombre officiel OmniBank (#0b1120).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO_PATH = ROOT / "static" / "img" / "logo.png"
BG_COLOR = (11, 17, 32)  # #0b1120 (--bg-base dark theme)


def make_square_icon(logo: Image.Image, size: int, logo_ratio: float = 0.68, circular_mask: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG_COLOR + (255,))
    target_w = int(size * logo_ratio)
    aspect = logo.height / logo.width
    target_h = int(target_w * aspect)
    if target_h > int(size * logo_ratio):
        target_h = int(size * logo_ratio)
        target_w = int(target_h / aspect)

    resized = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)
    offset = ((size - target_w) // 2, (size - target_h) // 2)
    canvas.alpha_composite(resized, offset)

    if circular_mask:
        mask = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, size - 1, size - 1), fill=255)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(canvas, (0, 0), mask)
        return out

    return canvas


def make_adaptive_foreground(logo: Image.Image, size: int) -> Image.Image:
    # Android adaptive icon safe zone is central 66% (72/108)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    target_w = int(size * 0.54)
    aspect = logo.height / logo.width
    target_h = int(target_w * aspect)
    resized = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)
    offset = ((size - target_w) // 2, (size - target_h) // 2)
    canvas.alpha_composite(resized, offset)
    return canvas


def make_splash(logo: Image.Image, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), BG_COLOR + (255,))
    min_dim = min(width, height)
    target_w = max(96, int(min_dim * 0.24))
    aspect = logo.height / logo.width
    target_h = int(target_w * aspect)
    resized = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)
    offset = ((width - target_w) // 2, (height - target_h) // 2)
    canvas.alpha_composite(resized, offset)
    return canvas.convert("RGB")


def main() -> None:
    if not LOGO_PATH.exists():
        raise FileNotFoundError(f"Missing logo: {LOGO_PATH}")

    logo = Image.open(LOGO_PATH).convert("RGBA")

    # 1. Store Master Assets (resources/)
    res_dir = ROOT / "resources"
    res_dir.mkdir(exist_ok=True)
    icon_1024_rgb = make_square_icon(logo, 1024, logo_ratio=0.70).convert("RGB")
    icon_1024_rgb.save(res_dir / "icon-1024.png", format="PNG")
    icon_512_rgb = make_square_icon(logo, 512, logo_ratio=0.70).convert("RGB")
    icon_512_rgb.save(res_dir / "icon-512.png", format="PNG")
    splash_2732 = make_splash(logo, 2732, 2732)
    splash_2732.save(res_dir / "splash-2732.png", format="PNG")

    # 2. iOS Assets
    ios_icon_path = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-512@2x.png"
    if ios_icon_path.parent.exists():
        # Apple App Store requires 1024x1024 RGB with NO alpha channel
        icon_1024_rgb.save(ios_icon_path, format="PNG")

    ios_splash_dir = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "Splash.imageset"
    if ios_splash_dir.exists():
        for fname in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
            splash_2732.save(ios_splash_dir / fname, format="PNG")

    # 3. Android Mipmap Icons
    android_res = ROOT / "android" / "app" / "src" / "main" / "res"
    mipmap_specs = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }
    for folder, (launcher_px, fg_px) in mipmap_specs.items():
        target_dir = android_res / folder
        if target_dir.exists():
            make_square_icon(logo, launcher_px, logo_ratio=0.70).save(target_dir / "ic_launcher.png", format="PNG")
            make_square_icon(logo, launcher_px, logo_ratio=0.70, circular_mask=True).save(
                target_dir / "ic_launcher_round.png", format="PNG"
            )
            make_adaptive_foreground(logo, fg_px).save(target_dir / "ic_launcher_foreground.png", format="PNG")

    # Remove default vector foreground if present so PNG foreground is used cleanly
    v24_fg = android_res / "drawable-v24" / "ic_launcher_foreground.xml"
    if v24_fg.exists():
        v24_fg.unlink()

    bg_xml = android_res / "values" / "ic_launcher_background.xml"
    if bg_xml.parent.exists():
        bg_xml.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            "<resources>\n"
            '    <color name="ic_launcher_background">#0B1120</color>\n'
            "</resources>\n",
            encoding="utf-8",
        )

    # 4. Android Splash Screens
    for splash_file in android_res.glob("drawable*/splash.png"):
        with Image.open(splash_file) as existing:
            w, h = existing.size
        make_splash(logo, w, h).save(splash_file, format="PNG")

    print("[OmniBank Assets] Generated iOS, Android, and Store icons/splash screens successfully.")


if __name__ == "__main__":
    main()

