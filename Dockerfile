# PrivyDoc Workspace — static Vite/React SPA served by nginx on Cloud Run.
#
# Vite bakes VITE_* env vars into the JS bundle at BUILD time, so the
# Supabase URL/anon key must arrive here as --build-arg (wired from
# cloudbuild.yaml substitutions), not as Cloud Run runtime env vars —
# runtime env vars are invisible to an already-built static bundle.
# The anon key is public by design (it ships in the client bundle on
# every deployment target, same as the current Netlify deploy).

# ---- Stage 1: build static assets ----
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first so Docker layer caching survives source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

RUN npm run build

# ---- Stage 2: serve via nginx ----
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Cloud Run sends traffic to $PORT, which defaults to 8080 for new
# services; nginx.conf listens on 8080 to match.
EXPOSE 8080
