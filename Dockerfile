# Versioni fissate apposta: cambiano solo quando lo decidiamo (Dependabot propone gli aggiornamenti).
# Tailscale: da qui prendiamo solo i due programmi (tailscale e tailscaled)
FROM tailscale/tailscale:v1.104.7 AS tailscale

FROM node:22.23.5-bookworm-slim

# Numero di versione e data, passati da GitHub Actions: l'app li mostra in fondo alla pagina
ARG VERSIONE=sviluppo
ARG DATA_VERSIONE=
ENV APP_VERSION=$VERSIONE \
    APP_BUILT=$DATA_VERSIONE

ENV NODE_ENV=production \
    TZ=Europe/Rome \
    DATA_DIR=/data \
    PORT=3000

# tini fa da "direttore" del container: chiude bene sia l'app sia Tailscale
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscaled /usr/local/bin/

WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app/ ./
RUN chmod +x /app/entrypoint.sh /app/avvio.sh && mkdir -p /data

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/salute').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Parte come root solo per sistemare i permessi di /data, poi passa all'utente "node"
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/entrypoint.sh"]
CMD ["/app/avvio.sh"]
