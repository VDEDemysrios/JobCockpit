# Fabriquer le trailer (montage cinématographique)

Tout est local : Edge sans interface piloté par le protocole DevTools,
ffmpeg (winget install Gyan.FFmpeg), musique synthétisée en Node. Aucune
collecte réelle : `serveur-factice.mjs` rejoue une collecte simulée.

1. Dossier de travail W. Copier `Application\data.db*` dans `W\db\`, et
   `public\fonts\*` dans `W\cartons\fonts\`. Copier ces scripts dans W.
2. `DB_PATH=W\db\data.db VITE=25 VITE_OFFRE=70 node serveur-factice.mjs`
   (depuis `scripts/trailer`, port 4321).
3. Prises de vues : `node cine.mjs scenes2.mjs` puis `node cine.mjs scenes3.mjs`
   → `W\frames\<prise>\` (images horodatées + chemin du curseur).
4. `node preparer.mjs` → `donnees.js` (listes d'images pour la page de montage).
5. `plan.js` = le montage : clips, caméra (zoom, panoramique, suivi du
   curseur), légendes, cartons, compteurs. `node timeline.mjs` donne les
   instants de coupe. Aperçu : `APERCU=1,12,30 node rendu.mjs` → `frames\apercu`.
6. `node rendu.mjs` rend `montage.html` image par image (30 i/s).
7. `RISER_DEBUT=17.6 RISER_DUREE=2.4 IMPACTS=<coupes> node musique.mjs musique.wav 58.7`
8. `node assembler.mjs <ffmpeg.exe> musique.wav trailer.mp4`
