# The web UI is built here and only its output is carried over, so web/'s
# node_modules never reaches the running image.
FROM node:22-slim AS web
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY web ./web
# vite writes to ../public — that is the directory the API serves.
RUN npm --prefix web run build


FROM node:22-slim

# Chromium comes from Debian rather than puppeteer's own download: it is
# patched by the distribution, and it is the only copy in the image. Bookworm
# carries 151 and puppeteer 25.8 targets 152 — one version apart, which is why
# the dependency was moved off the 23.x line.
# fonts-thai-tlwg is what makes the PDF legible at all — without a Thai font
# Chromium draws the whole record as boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-thai-tlwg \
      fontconfig \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY data ./data
COPY --from=web /app/public ./public

# The office's own fonts, if they were put in fonts/ — TH Sarabun New is not
# in any Debian repository and is not redistributed here. The package.json is
# only there so the COPY still succeeds when fonts/ does not exist.
COPY package.json fonts*/ /usr/share/fonts/truetype/office/
RUN rm -f /usr/share/fonts/truetype/office/package.json && fc-cache -f

# Chromium's sandbox is already off (see the launch args); this only makes
# sure nothing in the container runs as root.
RUN useradd --create-home --shell /usr/sbin/nologin app && chown -R app /app
USER app

EXPOSE 3000
CMD ["node", "src/server.js"]
