# Dashboard image — Python stdlib only, no pip install needed.
# Frontend is prebuilt in dist/ (committed), so no Node in the image.
FROM python:3.12-slim

WORKDIR /app

# Copy the app (see .dockerignore for exclusions: node_modules, .git, Statements).
COPY . .

RUN chmod +x /app/entrypoint.sh

# Inside the container, bind all interfaces so Caddy (separate container) can reach us.
# Caddy is the only thing published to the host — this port stays on the internal network.
ENV DASH_HOST=0.0.0.0
ENV DASH_PORT=8787
EXPOSE 8787

# First boot on a fresh data volume creates the DB; subsequent boots reuse it.
ENTRYPOINT ["/app/entrypoint.sh"]
