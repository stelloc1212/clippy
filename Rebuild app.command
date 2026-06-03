#!/bin/zsh
# Herbouwt Clippy.app na wijzigingen in de broncode (main.js / preload.js / renderer).
# Dubbelklik dit bestand om te updaten.
cd "$(dirname "$0")"

echo "Clippy afsluiten…"
pkill -f "Clippy.app/Contents/MacOS/Clippy" 2>/dev/null
sleep 1

echo "Oude build opruimen…"
rm -rf dist Clippy.app 2>/dev/null

echo "Clippy.app opnieuw bouwen…"
npx --yes @electron/packager . Clippy --platform=darwin --overwrite \
  --app-bundle-id=com.clippyclaude.app \
  --app-category-type=public.app-category.productivity \
  --out=dist \
  --ignore="(^/Clippy\.app|^/dist|^/browser-profile|clippy\.log|screen\.png)" || { echo "Bouwen mislukt."; exit 1; }

APP="dist/Clippy-darwin-$(uname -m)/Clippy.app"
echo "Ondertekenen en plaatsen…"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
rm -rf "Clippy.app"
ditto "$APP" "Clippy.app"
xattr -cr "Clippy.app"
codesign --force --deep --sign - "Clippy.app" >/dev/null 2>&1
rm -rf dist

echo ""
echo "Klaar! Clippy.app is bijgewerkt."
echo "Open Clippy via je snelkoppeling in de map Codes."
echo "Let op: als het scherm-meekijken niet meer werkt, zet 'Clippy' eenmalig"
echo "opnieuw aan bij Systeeminstellingen > Privacy > Schermopname."
echo ""
echo "Je kunt dit venster sluiten."
