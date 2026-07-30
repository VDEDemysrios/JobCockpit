# Image de Job Cockpit pour Fly.io.
#
# Node 22+ est OBLIGATOIRE : toute la base repose sur `node:sqlite`, intégré
# au moteur depuis cette version. Sur une image plus ancienne, le serveur
# échoue au premier import, sans message utile.
FROM node:24-alpine

WORKDIR /app

# Les dépendances d'abord : cette couche n'est reconstruite que si
# package.json change, ce qui rend les redéploiements de code quasi instantanés.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# La base vit sur le volume monté, pas dans l'image : sans cela, chaque
# déploiement effacerait les offres, le suivi et les lettres.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/data.db \
    COLLECTE_AUTO=1

EXPOSE 3000

# `amorcer-base` ne fait quelque chose qu'au tout premier démarrage, quand le
# volume est encore vide. Ensuite il s'efface devant la base existante.
CMD ["sh", "-c", "node scripts/amorcer-base.js && node src/server.js"]
