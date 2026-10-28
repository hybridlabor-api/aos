FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Allowlist, not `COPY .`: untracked local files (e.g. mcps/*/.env.production) must never enter the image.
COPY package.json package-lock.json /opt/aos/
COPY bin/ /opt/aos/bin/
COPY lib/ /opt/aos/lib/
COPY .claude/hooks/ /opt/aos/.claude/hooks/
RUN cd /opt/aos && npm ci --omit=dev --ignore-scripts
ENV PATH="/opt/aos/bin:${PATH}"
RUN useradd -m -d /home/aos aos
USER aos
WORKDIR /work
